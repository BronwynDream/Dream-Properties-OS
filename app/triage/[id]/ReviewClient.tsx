"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { classifyBatch, setFileType, commitBatch, proposeMatches, decideMatch } from "../actions";
import DiffPanel from "./DiffPanel";
import { PropertyDiff } from "@/lib/diff";

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
type Match = {
  id: string;
  target_kind: "property" | "party";
  extracted_ref: string;
  candidate_id: string | null;
  candidate_label: string | null;
  score: number | null;
  decision: "undecided" | "link" | "create" | "merge";
};

// Human labels for extracted_ref target keys.
function targetLabel(ref: string): string {
  if (ref === "property") return "Property";
  const m = ref.match(/^(seller|purchaser)_(\d+)$/);
  if (m) return `${m[1] === "seller" ? "Seller" : "Purchaser"} ${m[2]}`;
  return ref;
}

// Pull the values we have for a target from the current extraction inputs.
// Used for the extracted-vs-existing side-by-side.
function extractedSummary(
  ref: string,
  extractions: Extraction[],
  values: Record<string, string>,
): string {
  const val = (e: Extraction) => (values[e.id] ?? e.proposed_value ?? "").trim();
  if (ref === "property") {
    const addr = extractions.find(
      (e) => e.target_table === "property" && e.target_field === "primary_address",
    );
    const deed = extractions.find(
      (e) => e.target_table === "property" && e.target_field === "title_deed_no",
    );
    const erf = extractions.find(
      (e) => e.target_table === "erf" && e.target_field === "erf_number",
    );
    const parts = [addr && val(addr), deed && val(deed) && `Deed ${val(deed)}`, erf && val(erf) && `Erf ${val(erf)}`]
      .filter(Boolean);
    return parts.join(" · ") || "(no property fields extracted)";
  }
  const name = extractions.find(
    (e) => e.entity_hint === ref && e.target_field === "display_name",
  );
  const id = extractions.find(
    (e) => e.entity_hint === ref && e.target_field === "id_number",
  );
  const parts = [name && val(name), id && val(id) && `ID ${val(id)}`].filter(Boolean);
  return parts.join(" · ") || "(no name extracted)";
}

export default function ReviewClient({
  batch,
  files,
  docTypes,
  extractions,
  matches,
  propertyDiff,
}: {
  batch: Batch;
  files: FileRow[];
  docTypes: DocType[];
  extractions: Extraction[];
  matches: Match[];
  propertyDiff: PropertyDiff | null;
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
  const [matchBusy, setMatchBusy] = useState(false);
  const committed = batch.status === "committed";

  // Group candidates by target for the Matches panel.
  const matchesByTarget = useMemo(() => {
    const m = new Map<string, Match[]>();
    for (const mc of matches) {
      if (!m.has(mc.extracted_ref)) m.set(mc.extracted_ref, []);
      m.get(mc.extracted_ref)!.push(mc);
    }
    return m;
  }, [matches]);

  // A target is "decided" when at least one row is 'link' OR all rows are 'create'.
  // Undecided targets block the Commit button.
  const undecidedTargets = useMemo(
    () =>
      Array.from(matchesByTarget.entries())
        .filter(([, rows]) => {
          const hasLink = rows.some((r) => r.decision === "link");
          const allCreate = rows.every((r) => r.decision === "create");
          return !(hasLink || allCreate);
        })
        .map(([ref]) => ref),
    [matchesByTarget],
  );

  const currentRows = () =>
    extractions.map((e) => ({
      target_table: e.target_table,
      target_field: e.target_field,
      entity_hint: e.entity_hint,
      value: values[e.id] ?? e.proposed_value ?? "",
    }));

  // Auto-propose matches whenever we have extractions but no candidate rows.
  // Fires on mount AND after Extract populates rows via router.refresh() —
  // the earlier once-per-mount ref guard missed the second firing because
  // useEffect deps didn't change. Belt-and-braces: /api/extract also calls
  // propose_matches server-side once extraction rows are written.
  const proposingRef = useRef(false);
  useEffect(() => {
    if (committed) return;
    if (extractions.length === 0) return;
    if (matches.length > 0) return;
    if (proposingRef.current) return;
    proposingRef.current = true;
    (async () => {
      setMatchBusy(true);
      await proposeMatches(batch.id, currentRows());
      setMatchBusy(false);
      proposingRef.current = false;
      router.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id, extractions.length, matches.length, committed]);

  async function rerunMatches() {
    setMatchBusy(true);
    await proposeMatches(batch.id, currentRows());
    setMatchBusy(false);
    router.refresh();
  }

  function pickLink(ref: string, candidateId: string) {
    startTransition(async () => {
      await decideMatch(batch.id, ref, candidateId, "link");
      router.refresh();
    });
  }
  function pickCreate(ref: string) {
    startTransition(async () => {
      await decideMatch(batch.id, ref, null, "create");
      router.refresh();
    });
  }
  function resetTarget(ref: string) {
    startTransition(async () => {
      await decideMatch(batch.id, ref, null, "reset");
      router.refresh();
    });
  }

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
        const parts: string[] = [];
        if (json.attachments > 0) {
          parts.push(
            `Unpacked ${json.attachments} attachment(s) from ${json.emails} of ${json.emailsAttempted ?? json.emails} email(s).`,
          );
        } else {
          parts.push(json.note || "No attachments extracted.");
        }
        if (Array.isArray(json.errors) && json.errors.length > 0) {
          const first = json.errors[0];
          parts.push(
            `${json.errors.length} error(s) — first: ${first.file} (${first.stage}): ${first.message}`,
          );
        }
        setExtractMsg(parts.join(" · "));
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

  async function runReclassify() {
    setExtractBusy(true);
    setExtractMsg("Reading unknown files…");
    try {
      const res = await fetch("/api/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      });
      const json = await res.json();
      if (json.ok) {
        setExtractMsg(
          json.changed > 0
            ? `Reclassified ${json.changed} of ${json.processed} unknown file(s).`
            : json.note || `Nothing to reclassify from ${json.processed} candidate(s).`,
        );
      } else {
        setExtractMsg(json.error || "Reclassify failed.");
      }
    } catch (e) {
      setExtractMsg(`Reclassify failed: ${(e as Error).message}`);
    } finally {
      setExtractBusy(false);
      router.refresh();
    }
  }

  const classified = files.filter((f) => f.detected_doc_type_id).length;
  const hasEml = files.some((f) =>
    f.original_filename.toLowerCase().endsWith(".eml"),
  );
  const otherTypeId = docTypes.find((d) => d.label === "Other")?.id;
  const unknownCount = files.filter(
    (f) =>
      !f.detected_doc_type_id ||
      f.detected_doc_type_id === otherTypeId ||
      (f.classification_confidence ?? 1) < 0.5,
  ).length;

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
            {unknownCount > 0 && (
              <button
                className="ghost-dark"
                onClick={runReclassify}
                disabled={extractBusy}
                title="Read each unknown file (OCR if scanned) and classify by content"
              >
                {extractBusy ? "Working…" : `Reclassify unknowns (${unknownCount})`}
              </button>
            )}
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

        {extractions.length > 0 && !committed && (
          <div className="match-panel" style={{ marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>Matches</h2>
              <span style={{ color: "#5b6885", fontSize: 13 }}>
                {matchesByTarget.size === 0
                  ? matchBusy
                    ? "Looking for candidates…"
                    : "No candidates found — safe to commit as new."
                  : undecidedTargets.length === 0
                    ? "All targets decided ✓"
                    : `${undecidedTargets.length} target(s) awaiting a call`}
              </span>
              <button
                className="ghost-dark"
                style={{ marginLeft: "auto" }}
                onClick={rerunMatches}
                disabled={matchBusy}
              >
                {matchBusy ? "Working…" : "Re-check matches"}
              </button>
            </div>

            {Array.from(matchesByTarget.entries()).map(([ref, rows]) => {
              const linked = rows.find((r) => r.decision === "link");
              const allCreate = rows.every((r) => r.decision === "create");
              const decided = !!linked || allCreate;
              return (
                <div key={ref} className="match-target" style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <strong>{targetLabel(ref)}</strong>
                    <span style={{ color: "#5b6885", fontSize: 13 }}>
                      extracted: {extractedSummary(ref, extractions, values)}
                    </span>
                    {decided && (
                      <button
                        className="ghost-dark"
                        style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                        onClick={() => resetTarget(ref)}
                        disabled={pending}
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {rows.map((r) => {
                      const isLinked = r.decision === "link";
                      return (
                        <div
                          key={r.id}
                          className="match-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "10px 12px",
                            border: "1px solid",
                            borderColor: isLinked ? "#1C5B3A" : "#e2e5ee",
                            background: isLinked ? "rgba(28,91,58,0.05)" : "#fff",
                            borderRadius: 6,
                          }}
                        >
                          <span style={{ flex: 1 }}>{r.candidate_label ?? "(unlabelled)"}</span>
                          <span
                            className="pill"
                            style={{ background: "#EDF0F8", color: "#15203A" }}
                          >
                            {r.score != null ? `${Math.round(r.score * 100)}%` : "—"}
                          </span>
                          {isLinked ? (
                            <span className="tier tier-green">linked</span>
                          ) : (
                            <button
                              className="ghost-dark"
                              onClick={() => r.candidate_id && pickLink(ref, r.id)}
                              disabled={pending || !r.candidate_id}
                            >
                              Link
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      className={allCreate ? "cta" : "ghost-dark"}
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => pickCreate(ref)}
                      disabled={pending || allCreate}
                    >
                      {allCreate ? "Creating new ✓" : "Create new record instead"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {propertyDiff && !committed && <DiffPanel diff={propertyDiff} />}

        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Proposed fields</h2>
          {extractions.length > 0 && !committed && (
            <button
              className="cta"
              style={{ marginLeft: "auto" }}
              onClick={runCommit}
              disabled={committing || undecidedTargets.length > 0}
              title={
                undecidedTargets.length > 0
                  ? `Decide matches first: ${undecidedTargets.map(targetLabel).join(", ")}`
                  : undefined
              }
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
                {rows.map((r) => (
                  <div key={r.id} className="kv-row">
                    <div className="kv-label">
                      <span className="mono">
                        {r.target_table}.{r.target_field}
                      </span>
                      <span className="kv-conf">
                        {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : ""}
                      </span>
                    </div>
                    <input
                      className="kv-input"
                      value={values[r.id] ?? r.proposed_value ?? ""}
                      disabled={committed}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
