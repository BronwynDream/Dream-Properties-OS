import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import InboxRow from "./InboxRow";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function InboxPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Batches from the email webhook, most recent first. Join to ingest_file
  // + document_type so we can filter to enquiry-flavoured ones in JS —
  // simpler than a SQL predicate, cheap at this scale.
  const { data: batches } = await supabase
    .from("ingest_batch")
    .select(
      "id, subject, sender_email, provider_message_id, status, created_at, files:ingest_file(id, original_filename, detected_doc_type_id, doc_type:document_type(code))",
    )
    .like("provider_message_id", "resend:%")
    .neq("status", "committed")
    .order("created_at", { ascending: false })
    .limit(200);

  // Enquiry-flavoured heuristic: no files classified as anything but
  // correspondence. Batches with a mandate / deed / agreement belong in
  // /triage, not the lead inbox.
  const rows = ((batches ?? []) as any[]).filter((b) => {
    const files = (b.files ?? []) as any[];
    if (files.length === 0) return true;
    return files.every((f) => {
      if (!f.detected_doc_type_id) return true;
      const code = f.doc_type?.code;
      return code === "correspondence" || code == null;
    });
  });

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Lead Inbox</p>
          <h1>{rows.length} incoming {rows.length === 1 ? "enquiry" : "enquiries"}</h1>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {rows.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", padding: "24px 0", fontStyle: "italic" }}>
              Nothing new. Enquiries forwarded to <code>intake@dreamproperties.app</code> land here.
            </p>
          ) : (
            <div className="lead-inbox">
              {rows.map((b: any) => (
                <InboxRow
                  key={b.id}
                  batchId={b.id}
                  sender={b.sender_email ?? "unknown sender"}
                  subject={b.subject ?? "(no subject)"}
                  fileCount={(b.files ?? []).length}
                  createdAt={b.created_at}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
