"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { finishUpload, startUpload } from "./actions";

type T = { id: string; code: string; label: string; category: string };

export default function UploadDoc({ transferId, partyId, side, docTypes, label = "Upload" }: { transferId: string; partyId: string | null; side: string | null; docTypes: T[]; label?: string }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(docTypes[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go(files: FileList | null) {
    if (!files?.length || !type) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const supabase = createClient();
      for (const f of Array.from(files)) {
        const s = await startUpload({ transferId, partyId, side, fileName: f.name, docTypeId: type });
        if (!s.ok) return setErr(s.error);
        const up = await supabase.storage.from("documents").uploadToSignedUrl(s.path, s.token, f, { contentType: f.type || undefined });
        if (up.error) return setErr(`"${f.name}" didn't upload: ${up.error.message}`);
        const r = await finishUpload({ transferId, partyId, side, path: s.path, ticket: s.ticket, name: f.name, size: f.size, mime: f.type || null, docTypeId: type });
        if (!r.ok) return setErr(r.error);
      }
      setMsg(`${files.length} filed.`);
      if (pick.current) pick.current.value = "";
      router.refresh();
    });
  }

  if (!docTypes.length) return null;
  return (
    <div className="fica-upload">
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type" disabled={pending}>
        {docTypes.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <button type="button" className="btn-secondary" onClick={() => pick.current?.click()} disabled={pending}>
        {pending ? "Uploading…" : label}
      </button>
      <input ref={pick} type="file" multiple hidden accept="application/pdf,image/*" onChange={(e) => go(e.target.files)} />
      {msg && <span className="adddocs-done" role="status">{msg}</span>}
      {err && <span className="adddocs-err" role="alert">{err}</span>}
    </div>
  );
}
