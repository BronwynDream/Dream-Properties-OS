"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { classifyBatch, setFileType, commitBatch } from "../actions";

type Batch = {
  id: string;
  label: string;
  status: string;
  tier: string | null;
  priority: string;
};
type FileRow = {
  id: string;
  original_filename: string;
  is_pii: boolean;
  status: string;
  classification_confidence: number | null;
  detected_doc_type_id: string | null;
};
type DocType = { id: string; label: string; category: string };
type Extraction = {
  id: string;
  target_table: string;
  target_field: string;
  entity_hint: string | null;
  proposed_value: string;
  confidence: number | null;
  status: string;
};

export default function ReviewClient({
  batch,
  files,
  docTypes,
  extractions,
}: {
  batch: Batch;
  files: FileRow[];
  docTypes: DocType[];
  extractions: Extraction[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(extractions.map((e) => [e.id, e.proposed_value ?? ""])),
  );
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const committed = batch.status === "committed";

  async function runCommit() {
    setCommitting(true);
    setCommitMsg("Writing to the live database…");
    const rows = extractions.map((e) => ({
      target_table: e.target_table,
      target_field: e.target_field,
      entity_hint: e.entity_hint,
      value: values[e.id] ?? e.proposed_value ?? "",
    }));
    const res = await commitBatch(batch.id, rows);
    setCommitMsg(res.ok ? "Committed to live records ✓" : `Commit failed: ${res.error}`);
    setCommitting(false);
    router.refresh();
  }

  function runClassify() {
    startTransition(async () => {
      await classifyBatch(batch.id);
      router.refresh();
    });
  }
  function changeType(fileId: string, docTypeId: string) {
    startTransition(async () => {
      await setFileType(fileId, batch.id, docTypeId);
      router.refresh();
    });
  }

  async function runUnpack() {
    setExtractBusy(true);
    setExtractMsg("Unpacking email attachments…");
    try {
      const res = await fetch("/api/unpack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      });
      const json = await res.json();
      if (json.ok) {
        await classifyBatch(batch.id);
        setExtractMsg(
          json.attachments > 0
            ? `Unpacked ${json.attachments} attachment(s) from ${json.emails} email(s) — now classified.`
            : json.note || "No email attachments to unpack.",
        );
      } else {
        setExtractMsg(json.error || "Nothing to unpack.");
      }
    } catch (e) {
      setExtractMsg(`Unpack failed: ${(e as Error).message}`);
    } finally {
      setExtractBusy(false);
      router.refresh();
    }
  }

  async function runExtract() {
    setExtractBusy(true);
    setExtractMsg("Reading documents…");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      });
      const json = await res.json();
      if (json.ok) {
        setExtractMsg(`Extracted ${json.rowsInserted} field(s) from: ${(json.used || []).join(", ")}`);
      } else {
        setExtractMsg(json.note || json.error || "Nothing extracted.");
      }
    } catch (e) {
      setExtractMsg(`Extraction failed: ${(e as Error).message}`);
    } finally {
      setExtractBusy(false);
      router.refresh();
    }
  }

  const classified = files.filter((f) => f.detected_doc_type_id).length;
  const hasEml = files.some((f) =>
    f.original_filename.toLowerCase().endsWith(".eml"),
  );

  // group extractions by entity_hint (seller_1, purchaser_2…) else by table
  const groups = new Map<string, Extraction[]>();
  for (const e of extractions) {
    const key = e.entity_hint ?? e.target_table;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return (
    <main>
      <header
        className="app-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <p className="eyebrow">Dream Knysna · Batch review</p>
          <h1>{batch.label}</h1>
        </div>
        <Link href="/triage" className="ghost-link">
          ← Queue
        </Link>
      </header>
      <hr className="tideline" />

      <section className="app-body" style={{ maxWidth: 1000 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
          {batch.tier && <span className={`tier tier-${batch.tier}`}>{batch.tier}</span>}
          <span className="pill">{batch.status}</span>
          <span style={{ color: "#5b6885", fontSize: 14 }}>
            {classified}/{files.length} classified
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {hasEml && (
              <button className="ghost-dark" onClick={runUnpack} disabled={extractBusy}>
                Unpack emails
              </button>
            )}
            <button className="ghost-dark" onClick={runClassify} disabled={pending}>
              {pending ? "Working…" : "Classify"}
            </button>
            <button className="cta" onClick={runExtract} disabled={extractBusy || classified === 0}>
              {extractBusy ? "Reading…" : "Extract fields (AI)"}
            </button>
          </div>
        </div>
        {extractMsg && <p className="dz-msg" style={{ marginTop: 0 }}>{extractMsg}</p>}

        <table className="queue">
          <thead>
            <tr>
              <th>File</th>
              <th>Detected type</th>
              <th>PII</th>
              <th>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td className="strong" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.original_filename}
                </td>
                <td>
                  <select
                    className="type-select"
                    value={f.detected_doc_type_id ?? ""}
                    disabled={pending}
                    onChange={(e) => changeType(f.id, e.target.value)}
                  >
                    <option value="" disabled>
                      — unclassified —
                    </option>
                    {docTypes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{f.is_pii ? <span className="tier tier-red">PII</span> : "—"}</td>
                <td>
                  {f.classification_confidence != null
                    ? `${Math.round(f.classification_confidence * 100)}%`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Proposed fields</h2>
          {extractions.length > 0 && !committed && (
            <button
              className="cta"
              style={{ marginLeft: "auto" }}
              onClick={runCommit}
              disabled={committing}
            >
              {committing ? "Committing…" : "Commit to database"}
            </button>
          )}
          {committed && (
            <span className="tier tier-green" style={{ marginLeft: "auto" }}>
              committed
            </span>
          )}
        </div>
        {commitMsg && <p className="dz-msg">{commitMsg}</p>}
        {extractions.length === 0 ? (
          <div className="note-box">
            <strong>No fields extracted yet.</strong>
            <p>
              Classify the batch, then click <em>Extract fields (AI)</em>. The agreement
              and related documents are read and their values proposed here for you to
              accept before committing to the live records.
            </p>
          </div>
        ) : (
          <div className="extract-groups">
            {Array.from(groups.entries()).map(([key, rows]) => (
              <div key={key} className="extract-card">
                <h3>{key.replace(/_/g, " ")}</h3>
                <table className="kv">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="k mono">
                          {r.target_table}.{r.target_field}
                        </td>
                        <td className="v">
                          <input
                            className="kv-input"
                            value={values[r.id] ?? r.proposed_value ?? ""}
                            disabled={committed}
                            onChange={(e) =>
                              setValues((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                          />
                        </td>
                        <td className="c">
                          {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
