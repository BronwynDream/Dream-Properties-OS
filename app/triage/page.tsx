import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import DropZone from "./DropZone";
import QueueActions from "./QueueActions";
import BulkExtract from "./BulkExtract";
export const dynamic = "force-dynamic";

type QueueRow = {
  id: string;
  label: string;
  status: string;
  tier: string | null;
  priority: string;
  confidence: number | null;
  file_count: number;
  proposed_count: number;
  confirmed_count: number;
  open_matches: number;
  created_at: string;
};

export default async function TriagePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("v_triage_queue")
    .select("*")
    .order("created_at", { ascending: false });

  const queue = (data ?? []) as QueueRow[];
  // If 0007/0008 haven't been run yet, the view won't exist.
  const notReady = !!error && /relation|does not exist|schema cache/i.test(error.message);

  return (
    <>
    <TopBar />
    <main>
      <header
        className="app-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <p className="eyebrow">Dream Knysna · Migration triage</p>
          <h1>Bring your folders in</h1>
        </div>
      </header>
      <hr className="tideline" />

      <section className="app-body" style={{ maxWidth: 1000 }}>
        <DropZone />

        {!notReady && queue.length > 0 && (
          <div
            style={{
              marginTop: 20,
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <QueueActions
              hasUnnamed={queue.some((b) => /^dropped files/i.test(b.label))}
            />
            <BulkExtract
              candidateIds={queue
                .filter(
                  (b) =>
                    b.proposed_count === 0 &&
                    b.status !== "committed" &&
                    b.status !== "uploaded" &&
                    b.file_count > 0,
                )
                .map((b) => b.id)}
            />
          </div>
        )}

        {notReady ? (
          <p className="error" style={{ marginTop: 24 }}>
            The staging tables aren&apos;t in the database yet. Run{" "}
            <code>0007_staging.sql</code> and <code>0008_triage_queue.sql</code> in the
            Supabase SQL Editor, then reload.
          </p>
        ) : queue.length === 0 ? (
          <p style={{ marginTop: 24, color: "#5b6885" }}>
            No batches yet. Choose a folder above to create the first one.
          </p>
        ) : (
          <table className="queue">
            <thead>
              <tr>
                <th>Folder</th>
                <th>Status</th>
                <th>Tier</th>
                <th>Priority</th>
                <th>Files</th>
                <th>Proposed</th>
                <th>Confirmed</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((b) => (
                <tr key={b.id}>
                  <td className="strong">
                    <Link href={`/triage/${b.id}`} className="row-link">
                      {b.label}
                    </Link>
                  </td>
                  <td>
                    <span className="pill">{b.status}</span>
                  </td>
                  <td>{b.tier ? <span className={`tier tier-${b.tier}`}>{b.tier}</span> : "—"}</td>
                  <td>{b.priority}</td>
                  <td>{b.file_count}</td>
                  <td>{b.proposed_count}</td>
                  <td>{b.confirmed_count}</td>
                  <td>{b.open_matches || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
    </>
  );
}
