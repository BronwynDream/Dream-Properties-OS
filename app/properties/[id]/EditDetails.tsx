"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePropertyDetails } from "./actions";

// "Edit details" on the property record (2026-10-17): the blanks an agent
// fills in on a record the website sync created — street address, suburb,
// erf number, size. Opens in place under the title.

export default function EditDetails(props: {
  propertyId: string;
  address: string;
  addressToConfirm: boolean;
  suburbId: string | null;
  extentSqm: number | null;
  erfNumber: string | null;
  suburbs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [address, setAddress] = useState(props.addressToConfirm ? "" : props.address);
  const [suburbId, setSuburbId] = useState(props.suburbId ?? "");
  const [extent, setExtent] = useState(props.extentSqm ? String(props.extentSqm) : "");
  const [erf, setErf] = useState(props.erfNumber ?? "");

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const n = extent.trim() ? Number(extent.replace(/[\s,]/g, "")) : null;
      const res = await updatePropertyDetails({
        propertyId: props.propertyId,
        primaryAddress: address,
        suburbId: suburbId || null,
        extentSqm: n,
        erfNumber: erf.trim() || null,
      });
      if (!res.ok) {
        setErr(res.error ?? "Couldn't save.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" className="edit-details-btn" onClick={() => setOpen(true)}>
        {props.addressToConfirm ? "Add the street address" : "Edit details"}
      </button>
    );
  }

  return (
    <form className="edit-details" onSubmit={save}>
      {props.addressToConfirm && (
        <p className="edit-details-note">
          The website didn&rsquo;t publish a street address, so this record is named &ldquo;{props.address}&rdquo; for now.
        </p>
      )}
      <label>
        <span>Street address</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 5 Thella Crescent, Leisure Isle"
          autoFocus
          required
        />
      </label>
      <div className="edit-details-row">
        <label>
          <span>Suburb</span>
          <select value={suburbId} onChange={(e) => setSuburbId(e.target.value)}>
            <option value="">—</option>
            {props.suburbs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Erf number</span>
          <input value={erf} onChange={(e) => setErf(e.target.value)} placeholder="e.g. 4521" inputMode="numeric" />
        </label>
        <label>
          <span>Erf size (m²)</span>
          <input value={extent} onChange={(e) => setExtent(e.target.value)} inputMode="decimal" />
        </label>
      </div>
      {err && <p className="edit-details-err" role="alert">{err}</p>}
      <div className="edit-details-actions">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
