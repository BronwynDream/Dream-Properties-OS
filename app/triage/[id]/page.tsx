import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import ReviewClient from "./ReviewClient";
import {
  FieldDiff,
  FileDiff,
  PropertyDiff,
  TransferSummary,
  fieldDiff,
  normaliseFilename,
} from "@/lib/diff";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BatchReview({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: batch } = await supabase
    .from("ingest_batch")
    .select("id, label, status, tier, priority")
    .eq("id", params.id)
    .single();
  if (!batch) notFound();

  const { data: files } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, is_pii, status, classification_confidence, detected_doc_type_id",
    )
    .eq("batch_id", params.id)
    .order("original_filename");

  const { data: docTypes } = await supabase
    .from("document_type")
    .select("id, label, category")
    .eq("active", true)
    .order("category")
    .order("label");

  const { data: extractions } = await supabase
    .from("extraction")
    .select("id, target_table, target_field, entity_hint, proposed_value, confidence, status")
    .eq("batch_id", params.id)
    .order("entity_hint", { ascending: true, nullsFirst: true });

  const { data: matches } = await supabase
    .from("match_candidate")
    .select("id, target_kind, extracted_ref, candidate_id, candidate_label, score, decision")
    .eq("batch_id", params.id)
    .order("extracted_ref")
    .order("score", { ascending: false });

  // ---- Batch differ ------------------------------------------------------
  // If the reviewer has decided to LINK the property target to an existing
  // property, compute what this batch would add / conflict with, so Bronwyn
  // can see the "nugget" before committing.
  let propertyDiff: PropertyDiff | null = null;
  const linkedProperty = (matches ?? []).find(
    (m: any) => m.extracted_ref === "property" && m.decision === "link" && m.candidate_id,
  );
  if (linkedProperty && linkedProperty.candidate_id) {
    propertyDiff = await computePropertyDiff(
      supabase,
      linkedProperty.candidate_id,
      linkedProperty.candidate_label,
      files ?? [],
      extractions ?? [],
    );
  }

  return (
    <>
      <TopBar />
      <ReviewClient
        batch={batch}
        files={files ?? []}
        docTypes={docTypes ?? []}
        extractions={extractions ?? []}
        matches={matches ?? []}
        propertyDiff={propertyDiff}
      />
    </>
  );
}

async function computePropertyDiff(
  supabase: any,
  propertyId: string,
  propertyLabel: string | null,
  batchFiles: any[],
  extractions: any[],
): Promise<PropertyDiff | null> {
  const { data: prop } = await supabase
    .from("property")
    .select(
      "id, primary_address, title_deed_no, extent_sqm, suburb:suburb_id(name)",
    )
    .eq("id", propertyId)
    .single();
  if (!prop) return null;

  const proposedFor = (table: string, field: string): string | null => {
    const r = extractions.find(
      (e) => e.target_table === table && e.target_field === field,
    );
    return (r?.proposed_value ?? "").trim() || null;
  };

  const fields: FieldDiff[] = [
    fieldDiff("Address", prop.primary_address ?? null, proposedFor("property", "primary_address")),
    fieldDiff("Title deed", prop.title_deed_no ?? null, proposedFor("property", "title_deed_no")),
    fieldDiff("Extent (m²)", prop.extent_sqm != null ? String(prop.extent_sqm) : null, proposedFor("property", "extent_sqm")),
    fieldDiff("Suburb", prop.suburb?.name ?? null, proposedFor("property", "suburb")),
    fieldDiff("Erf", null, proposedFor("erf", "erf_number")),
  ];

  // Existing documents linked to the property.
  const { data: existingLinks } = await supabase
    .from("document_link")
    .select("document:document_id(id, title, byte_size)")
    .eq("entity_type", "property")
    .eq("entity_id", propertyId);

  const existingNames = new Set<string>();
  for (const l of existingLinks ?? []) {
    const d = (l as any).document;
    if (d?.title) existingNames.add(normaliseFilename(d.title));
  }

  const newFiles: FileDiff[] = [];
  const dupeFiles: FileDiff[] = [];
  for (const f of batchFiles) {
    // Only count files that would be promoted to documents on commit
    // (skip .eml wrappers and unclassified files).
    if (f.original_filename.toLowerCase().endsWith(".eml")) continue;
    if (!f.detected_doc_type_id) continue;
    const norm = normaliseFilename(f.original_filename);
    if (existingNames.has(norm)) {
      dupeFiles.push({ name: f.original_filename, kind: "duplicate" });
    } else {
      newFiles.push({ name: f.original_filename, kind: "new" });
    }
  }

  // Existing transfers on this property with a summary of their agreement.
  const { data: transfersData } = await supabase
    .from("transfer")
    .select("id, name, status, transfer_date, registered_date, created_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  const transferIds = (transfersData ?? []).map((t: any) => t.id);

  const { data: agreementsData } = transferIds.length
    ? await supabase.from("agreement").select("transfer_id, price, signature_date").in("transfer_id", transferIds)
    : { data: [] };

  const agByTransfer = new Map<string, any>();
  for (const a of (agreementsData ?? []) as any[]) {
    if (!agByTransfer.has(a.transfer_id)) agByTransfer.set(a.transfer_id, a);
  }

  const existingTransfers: TransferSummary[] = (transfersData ?? []).map((t: any) => {
    const a = agByTransfer.get(t.id);
    return {
      id: t.id,
      name: t.name,
      status: t.status ?? null,
      transferDate: t.transfer_date ?? null,
      registeredDate: t.registered_date ?? null,
      price: a?.price != null ? Number(a.price) : null,
      agreementDate: a?.signature_date ?? null,
    };
  });

  const proposedPrice = proposedFor("agreement", "price");
  const proposedDate = proposedFor("agreement", "transfer_date");

  // Collect proposed party names for the "this batch's transfer" summary.
  const parties = extractions
    .filter((e) => e.target_field === "display_name" && e.entity_hint)
    .map((e) => (e.proposed_value ?? "").trim())
    .filter(Boolean);

  // Only flag "would create new transfer" if this batch has an agreement at all.
  const hasProposedAgreement = !!(proposedPrice || proposedDate || parties.length > 0);
  let wouldCreateNewTransfer = false;
  if (hasProposedAgreement) {
    // If any existing transfer shares the same price AND date, treat as the same transfer.
    const matches = existingTransfers.find(
      (t) =>
        proposedPrice &&
        t.price != null &&
        String(t.price) === proposedPrice &&
        proposedDate &&
        t.transferDate === proposedDate,
    );
    wouldCreateNewTransfer = !matches;
  }

  const counts = {
    adds: fields.filter((f) => f.kind === "adds").length,
    conflicts: fields.filter((f) => f.kind === "conflict").length,
    filled: fields.filter((f) => f.kind === "adds").length,
  };

  return {
    propertyId,
    propertyLabel: propertyLabel ?? prop.primary_address ?? "Existing property",
    fields,
    files: { new: newFiles, duplicate: dupeFiles },
    existingTransfers,
    wouldCreateNewTransfer,
    proposedTransfer: {
      price: proposedPrice,
      date: proposedDate,
      parties,
    },
    counts,
  };
}
