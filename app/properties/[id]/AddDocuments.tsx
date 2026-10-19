"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { fileDocuments } from "./actions";

// The scanner (canvas maths + pdf-lib) loads only when someone taps Scan.
const ScanPages = dynamic(() => import("./ScanPages"), { ssr: false });

// "Add documents" on the property record (2026-10-19). Agents file their
// own papers onto their deal — signed mandates, IDs, plans, certificates —
// from the office or from a phone in the field ("Take a photo" opens the
// camera). Files go straight to storage; fileDocuments() then files them
// under the deal after checking the agent works on it.

export type DocTypeOption = { id: string; label: string; category: string };

const CATEGORY_LABEL: Record<string, string> = {
  mandate: "Mandates",
  agreement: "Agreements",
  fica: "FICA (identity)",
  compliance: "Compliance certificates",
  plan: "Plans & drawings",
  listing: "Listing",
  municipal: "Municipal",
  company: "Company / trust",
  correspondence: "Correspondence",
  other: "Other",
};

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").slice(0, 120);

export default function AddDocuments({
  propertyId,
  transferId,
  docTypes,
}: {
  propertyId: string;
  transferId: string | null;
  docTypes: DocTypeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [docTypeId, setDocTypeId] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const groups = docTypes.reduce<Record<string, DocTypeOption[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  function add(list: FileList | null) {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)]);
    setErr(null);
    setDone(null);
  }

  function file() {
    setErr(null);
    setDone(null);
    start(async () => {
      const supabase = createClient();
      const uploaded: { path: string; name: string; size: number; mime: string | null }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        const name = f.name || `Photo ${new Date().toISOString().slice(0, 16).replace("T", " ")}.jpg`;
        const path = `uploads/${propertyId}/${crypto.randomUUID()}-${safeName(name)}`;
        const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type || undefined });
        if (error) {
          setProgress(null);
          setErr(`"${name}" didn't upload: ${error.message}`);
          return;
        }
        uploaded.push({ path, name, size: f.size, mime: f.type || null });
      }
      setProgress("Filing…");
      const res = await fileDocuments({ propertyId, transferId, docTypeId: docTypeId || null, files: uploaded });
      setProgress(null);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setDone(`${res.filed} ${res.filed === 1 ? "document" : "documents"} filed on this deal.`);
      setFiles([]);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="adddocs-closed">
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          + Add documents
        </button>
        <button
          type="button"
          className="btn-secondary adddocs-camera"
          onClick={() => {
            setOpen(true);
            setScanning(true);
          }}
        >
          Scan pages
        </button>
        {done && <span className="adddocs-done" role="status">{done}</span>}
      </div>
    );
  }

  return (
    <section className="adddocs" aria-label="Add documents">
      <div className="adddocs-head">
        <h3>Add documents</h3>
        <button type="button" className="adddocs-link" onClick={() => setOpen(false)} disabled={pending}>
          Close
        </button>
      </div>

      <div
        className="adddocs-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        <p>Drop files here, or</p>
        <div className="adddocs-pickers">
          <button type="button" className="btn-secondary" onClick={() => pick.current?.click()} disabled={pending}>
            Choose files
          </button>
          <button type="button" className="btn-secondary adddocs-scan" onClick={() => setScanning(true)} disabled={pending}>
            Scan pages
          </button>
          <button type="button" className="btn-secondary adddocs-camera" onClick={() => camera.current?.click()} disabled={pending}>
            Take a photo
          </button>
        </div>
        <input ref={pick} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
      </div>

      {scanning && (
        <ScanPages
          onClose={() => setScanning(false)}
          onDone={(f) => {
            setScanning(false);
            setFiles((all) => [...all, f]);
            setErr(null);
            setDone(null);
          }}
        />
      )}

      {files.length > 0 && (
        <ul className="adddocs-files" role="list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name || "Photo"}</span>
              <span className="adddocs-size">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              <button
                type="button"
                className="adddocs-link"
                onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                disabled={pending}
                aria-label={`Remove ${f.name || "photo"}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="adddocs-type">
        <span>What are they?</span>
        <select value={docTypeId} onChange={(e) => setDocTypeId(e.target.value)} disabled={pending}>
          <option value="">Not sure / other</option>
          {Object.entries(groups).map(([cat, list]) => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="adddocs-go">
        <button type="button" className="btn-primary" disabled={!files.length || pending} onClick={file}>
          {pending ? progress ?? "Working…" : `File ${files.length || ""} ${files.length === 1 ? "document" : "documents"}`.replace("  ", " ")}
        </button>
        {!transferId && <span className="adddocs-note">They&apos;ll be filed on this property&apos;s deal (opened for you if there isn&apos;t one yet).</span>}
        {err && <p className="adddocs-err" role="alert">{err}</p>}
        {done && <p className="adddocs-done" role="status">{done}</p>}
      </div>
    </section>
  );
}
