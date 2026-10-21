"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignDocument } from "./actions";

export default function AssignDoc({ transferId, documentId, options }: { transferId: string; documentId: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!options.length) return null;
  return (
    <span className="fica-assign">
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose document is this?" disabled={pending}>
        <option value="">Whose is it?</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn-secondary"
        disabled={!who || pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const [partyId, side] = who.split("|");
            const r = await assignDocument({ transferId, partyId, side, documentId });
            if (!r.ok) setErr(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "…" : "Assign"}
      </button>
      {err && <span className="adddocs-err" role="alert">{err}</span>}
    </span>
  );
}
