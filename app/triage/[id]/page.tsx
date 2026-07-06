import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import ReviewClient from "./ReviewClient";

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

  return (
    <>
      <TopBar />
      <ReviewClient
        batch={batch}
        files={files ?? []}
        docTypes={docTypes ?? []}
        extractions={extractions ?? []}
        matches={matches ?? []}
      />
    </>
  );
}
