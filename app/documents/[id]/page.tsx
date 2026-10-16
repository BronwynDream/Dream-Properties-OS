import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDreamAgency } from "@/lib/agency";
import { loadTemplate } from "@/lib/documents/resolve";
import DraftEditor from "./DraftEditor";
import { refreshPpraTokens } from "@/lib/documents/ppra";

// Open a saved document draft in the editor (plan 019 Arc A4).
// Not wrapped in <TopBar> — same reasoning as the mandate page: a printable
// document surface reads as its own thing.

export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  title: string | null;
  status: "draft" | "final" | "superseded";
  version: number;
  property_id: string | null;
  transfer_id: string | null;
  field_values: Record<string, unknown>;
  clause_selections: Record<string, string>;
  clause_overrides: Record<string, string>;
  omitted_clauses: string[];
  created_at: string;
  finalised_at: string | null;
  signed_at: string | null;
  rendered_document_id: string | null;
  signed_document_id: string | null;
  template: { code: string; label: string } | { code: string; label: string }[] | null;
};

export default async function DraftPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("document_draft")
    .select("id, title, status, version, property_id, transfer_id, field_values, clause_selections, clause_overrides, omitted_clauses, created_at, finalised_at, signed_at, rendered_document_id, signed_document_id, template:template_id(code, label)")
    .eq("id", params.id)
    .maybeSingle();
  const draft = data as unknown as DraftRow | null;
  if (!draft) notFound();

  const tpl = Array.isArray(draft.template) ? draft.template[0] : draft.template;
  const model = tpl ? await loadTemplate(supabase, tpl.code) : null;
  if (!model) notFound();

  const { data: versions } = await supabase
    .from("document_draft_version")
    .select("version, saved_at, note, saver:saved_by(full_name)")
    .eq("draft_id", draft.id)
    .order("version", { ascending: false })
    .limit(20);

  const agency = await getDreamAgency();
  const fieldValues = await refreshPpraTokens(supabase, {
    template_code: tpl?.code ?? null,
    transfer_id: draft.transfer_id,
    property_id: draft.property_id,
    field_values: (draft.field_values ?? {}) as Record<string, string | number | boolean | null>,
  });

  return (
    <main style={{ background: "#F5F1E8", minHeight: "100vh", padding: "20px 20px 60px" }}>
      <div className="no-print" style={{ maxWidth: 1100, margin: "0 auto 12px", display: "flex", gap: 16, fontSize: 12 }}>
        {draft.property_id && (
          <Link href={`/properties/${draft.property_id}`} style={{ color: "var(--paper-mute)", textDecoration: "none" }}>
            ← Property record
          </Link>
        )}
        <Link href="/documents" style={{ color: "var(--paper-mute)", textDecoration: "none" }}>
          All documents
        </Link>
      </div>
      <DraftEditor
        draft={{
          id: draft.id,
          title: draft.title ?? model.label,
          status: draft.status,
          version: draft.version,
          field_values: fieldValues,
          clause_selections: draft.clause_selections ?? {},
          clause_overrides: draft.clause_overrides ?? {},
          omitted_clauses: draft.omitted_clauses ?? [],
          finalised_at: draft.finalised_at,
          signed_at: draft.signed_at,
          has_pdf: !!draft.rendered_document_id,
          has_signed: !!draft.signed_document_id,
        }}
        model={model}
        agency={agency}
        versions={((versions ?? []) as unknown as { version: number; saved_at: string; note: string | null; saver: { full_name: string } | { full_name: string }[] | null }[]).map((v) => ({
          version: v.version,
          saved_at: v.saved_at,
          note: v.note,
          by: (Array.isArray(v.saver) ? v.saver[0] : v.saver)?.full_name ?? null,
        }))}
      />
    </main>
  );
}
