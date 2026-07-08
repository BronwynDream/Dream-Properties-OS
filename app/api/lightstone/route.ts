import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLightstoneAdapter, type ProductCode } from "@/lib/lightstone";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/lightstone
// Body: { propertyId: string, productCodes: ProductCode[] }
// Admin-gated. Resolves the property's address/erf/deed, calls the adapter,
// creates a `document` row + `document_link` to the property for each result,
// updates the property with any structured fields (coalesce — never overwrite
// non-null), and creates owner parties + property_ownership_history entries
// where the adapter returned owners.
//
// Bucket note: reuses the private `staging` bucket for now — same access model
// as everything else (staff-only via signed URLs). If the media/documents
// buckets get split out later, only this route + the take-on flow need to
// point at them.

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  let body: { propertyId?: string; productCodes?: ProductCode[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const propertyId = body.propertyId;
  const productCodes = Array.isArray(body.productCodes) ? body.productCodes : [];
  if (!propertyId || productCodes.length === 0) {
    return NextResponse.json(
      { error: "propertyId and at least one productCode required" },
      { status: 400 },
    );
  }

  const { data: prop } = await supabase
    .from("property")
    .select("id, primary_address, title_deed_no, extent_sqm, erven:erf(erf_number)")
    .eq("id", propertyId)
    .single();
  if (!prop) return NextResponse.json({ error: "property not found" }, { status: 404 });

  const ref = {
    address: prop.primary_address ?? undefined,
    erf: (prop.erven as any[])?.[0]?.erf_number ?? undefined,
    deed: prop.title_deed_no ?? undefined,
  };

  const adapter = getLightstoneAdapter();
  let result;
  try {
    result = await adapter.fetchProducts(ref, productCodes);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }

  // Resolve doc-type ids once — used for every document created.
  const { data: docTypes } = await supabase
    .from("document_type")
    .select("id, code, is_pii_default");
  const typeByCode = new Map<
    string,
    { id: string; is_pii_default: boolean }
  >();
  for (const t of (docTypes ?? []) as any[]) {
    typeByCode.set(t.code, { id: t.id, is_pii_default: t.is_pii_default });
  }

  const created: { code: string; documentId: string; title: string }[] = [];
  const errors = [...result.errors];

  for (const p of result.fetched) {
    try {
      const codeForType =
        p.code === "title_deed" ? "title_deed" : "lightstone_report";
      const typeRow = typeByCode.get(codeForType);
      const docTypeId = typeRow?.id ?? null;
      const isPii = typeRow?.is_pii_default ?? false;

      // Build a safe filename from the title.
      const ext =
        p.documentMime === "application/pdf" ? "pdf" :
        p.documentMime === "text/plain"     ? "txt" :
        "bin";
      const safeSlug = p.documentTitle
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const storagePath = `${propertyId}/lightstone/${Date.now()}-${safeSlug}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("staging")
        .upload(storagePath, p.documentBytes, {
          contentType: p.documentMime,
          upsert: true,
        });
      if (upErr) {
        errors.push(`upload failed for ${p.label}: ${upErr.message}`);
        continue;
      }

      const { data: doc, error: docErr } = await supabase
        .from("document")
        .insert({
          doc_type_id: docTypeId,
          title: p.documentTitle,
          storage_bucket: "staging",
          storage_path: storagePath,
          mime_type: p.documentMime,
          byte_size: p.documentBytes.length,
          is_pii: isPii,
          status: "final",
          uploaded_by: user.id,
        })
        .select("id")
        .single();
      if (docErr || !doc) {
        errors.push(
          `document row failed for ${p.label}: ${docErr?.message ?? "insert returned no id"}`,
        );
        continue;
      }

      await supabase.from("document_link").insert({
        document_id: doc.id,
        entity_type: "property",
        entity_id: propertyId,
      });

      created.push({
        code: p.code,
        documentId: doc.id,
        title: p.documentTitle,
      });

      // Structured-field coalesce — never overwrite non-null property fields.
      if (p.structuredFields) {
        const updates: Record<string, any> = {};
        if (p.structuredFields.title_deed_no && !prop.title_deed_no) {
          updates.title_deed_no = p.structuredFields.title_deed_no;
        }
        if (p.structuredFields.extent_sqm && !prop.extent_sqm) {
          updates.extent_sqm = p.structuredFields.extent_sqm;
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("property").update(updates).eq("id", propertyId);
          // Update the local reference so subsequent products in this same
          // call see the newly-filled values and don't fight over them.
          Object.assign(prop, updates);
        }

        // Owners → party + property_ownership_history. Uses coalesce match:
        // by id_number first, then by display_name ilike; create if none.
        for (const owner of p.structuredFields.owners ?? []) {
          const name = owner.display_name?.trim();
          if (!name) continue;

          let partyId: string | null = null;

          if (owner.id_number) {
            const { data: byId } = await supabase
              .from("party")
              .select("id")
              .eq("id_number", owner.id_number)
              .maybeSingle();
            partyId = byId?.id ?? null;
          }
          if (!partyId) {
            const { data: byName } = await supabase
              .from("party")
              .select("id")
              .ilike("display_name", name)
              .maybeSingle();
            partyId = byName?.id ?? null;
          }
          if (!partyId) {
            const { data: fresh } = await supabase
              .from("party")
              .insert({
                party_type: "individual",
                display_name: name,
                id_number: owner.id_number ?? null,
              })
              .select("id")
              .single();
            partyId = fresh?.id ?? null;
          }

          if (partyId) {
            await supabase.from("property_ownership_history").insert({
              property_id: propertyId,
              owner_party_id: partyId,
              owner_name_raw: name,
              source: "lightstone",
            });
          }
        }
      }
    } catch (e) {
      errors.push(`processing ${p.label} failed: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    source: result.source,
    created,
    errors,
  });
}
