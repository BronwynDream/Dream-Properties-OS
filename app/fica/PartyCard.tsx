"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeskParty } from "@/lib/ficaDesk";
import { savePartyDetails, setFica } from "./actions";
import UploadDoc from "./UploadDoc";

type T = { id: string; code: string; label: string; category: string };

const MARITAL: [string, string][] = [
  ["unknown", "Not recorded"],
  ["single", "Single"],
  ["married_in_community", "Married in community of property"],
  ["married_anc_no_accrual", "Married ANC, no accrual"],
  ["married_anc_with_accrual", "Married ANC, with accrual"],
  ["foreign_marriage", "Foreign marriage"],
  ["divorced", "Divorced"],
  ["widowed", "Widowed"],
];
const FICA_STATUS: [string, string][] = [
  ["outstanding", "Outstanding"],
  ["received", "Documents received"],
  ["verified", "Verified"],
  ["expired", "Expired"],
];
const TAX: Record<string, string> = { resident: "SA resident", non_resident: "Non-resident", unknown: "" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function PartyCard({ transferId, party, docTypes }: { transferId: string; party: DeskParty; docTypes: T[] }) {
  const router = useRouter();
  const f = party.fields;
  const individual = party.partyType === "individual";
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ficaErr, setFicaErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const str = (k: string) => (f[k] == null ? "" : String(f[k]));

  function save(form: FormData) {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) fields[k] = String(v);
    if (!individual) fields.is_vat_registered = form.get("is_vat_registered") === "on";
    start(async () => {
      setErr(null);
      const r = await savePartyDetails({ transferId, partyId: party.id, fields });
      if (!r.ok) setErr(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function saveFica(form: FormData) {
    start(async () => {
      setFicaErr(null);
      const r = await setFica({
        transferId,
        partyId: party.id,
        side: party.side,
        status: String(form.get("status")),
        risk: String(form.get("risk")),
        notes: String(form.get("notes") ?? ""),
        sourceOfFunds: String(form.get("source_of_funds") ?? ""),
      });
      if (!r.ok) setFicaErr(r.error);
      else router.refresh();
    });
  }

  const shown: [string, string][] = individual
    ? [
        ["ID number", str("id_number")],
        ["Passport", str("passport_no")],
        ["Date of birth", str("date_of_birth")],
        ["Marital status", MARITAL.find(([v]) => v === str("matrimonial_regime"))?.[1] ?? "Not recorded"],
        ["Residential address", str("physical_address")],
        ["Postal address", str("postal_address")],
        ["Tax residency", TAX[str("tax_residency")] ?? ""],
        ["Email", str("email")],
        ["Phone", str("phone")],
      ]
    : [
        ["Registered name", str("entity_name")],
        ["Registration / trust no.", str("registration_no")],
        ["Registered address", str("physical_address")],
        ["Postal address", str("postal_address")],
        ["VAT", f.is_vat_registered ? str("vat_number") || "Registered" : "Not registered"],
        ["Tax residency", TAX[str("tax_residency")] ?? ""],
        ["Email", str("email")],
        ["Phone", str("phone")],
      ];

  return (
    <article className={`fica-card${party.gaps.length ? "" : " clear"}`}>
      <header className="fica-card-head">
        <div>
          <p className="eyebrow">{party.side === "seller" ? "Seller" : "Buyer"}{party.partyType !== "individual" ? ` · ${party.partyType.replace("_", " ")}` : ""}</p>
          <h2>{party.name}</h2>
        </div>
        <span className={`fica-count${party.gaps.length ? "" : " ok"}`}>{party.gaps.length ? `${party.gaps.length} missing` : "Complete"}</span>
      </header>

      {party.gaps.length > 0 && (
        <ul className="fica-gaps" role="list">
          {party.gaps.map((g) => <li key={g}>{g}</li>)}
        </ul>
      )}

      <section>
        <h3>Documents</h3>
        {party.docs.length ? (
          <ul className="fica-docs" role="list">
            {party.docs.map((d) => (
              <li key={d.id}>
                <a href={`/api/fica/doc/${d.id}`} target="_blank" rel="noopener">{d.label ?? d.title}</a>
                <span className="fica-when">{d.title !== d.label ? d.title : ""} {day(d.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fica-sub">None yet.</p>
        )}
        <UploadDoc transferId={transferId} partyId={party.id} side={party.side} docTypes={docTypes.filter((t) => t.category !== "compliance")} label="Upload for this person" />
      </section>

      <section>
        <div className="fica-h3row">
          <h3>Details</h3>
          {!editing && <button type="button" className="adddocs-link" onClick={() => setEditing(true)}>Edit</button>}
        </div>
        {!editing ? (
          <dl className="fica-dl">
            {shown.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className={v ? "" : "empty"}>{v || "—"}</dd></div>
            ))}
          </dl>
        ) : (
          <form action={save} className="fica-form">
            {individual ? (
              <>
                <label>First names<input name="first_names" defaultValue={str("first_names")} /></label>
                <label>Surname<input name="surname" defaultValue={str("surname")} /></label>
                <label>ID number<input name="id_number" defaultValue={str("id_number")} inputMode="numeric" /></label>
                <label>Passport number<input name="passport_no" defaultValue={str("passport_no")} /></label>
                <label>Date of birth<input name="date_of_birth" type="date" defaultValue={str("date_of_birth")} /></label>
                <label>Marital status
                  <select name="matrimonial_regime" defaultValue={str("matrimonial_regime") || "unknown"}>
                    {MARITAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>Registered name<input name="entity_name" defaultValue={str("entity_name")} /></label>
                <label>Registration / trust number<input name="registration_no" defaultValue={str("registration_no")} /></label>
                <label className="fica-check"><input type="checkbox" name="is_vat_registered" defaultChecked={!!f.is_vat_registered} /> VAT registered</label>
                <label>VAT number<input name="vat_number" defaultValue={str("vat_number")} /></label>
              </>
            )}
            <label className="wide">{individual ? "Residential address" : "Registered address"}<textarea name="physical_address" rows={2} defaultValue={str("physical_address")} /></label>
            <label className="wide">Postal address<textarea name="postal_address" rows={2} defaultValue={str("postal_address")} /></label>
            <label>Tax residency
              <select name="tax_residency" defaultValue={str("tax_residency") || "unknown"}>
                <option value="unknown">Not recorded</option>
                <option value="resident">SA resident</option>
                <option value="non_resident">Non-resident</option>
              </select>
            </label>
            <label>Email<input name="email" type="email" defaultValue={str("email")} /></label>
            <label>Phone<input name="phone" defaultValue={str("phone")} inputMode="tel" /></label>
            <div className="fica-form-go wide">
              <button className="btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save details"}</button>
              <button className="btn-secondary" type="button" onClick={() => setEditing(false)} disabled={pending}>Cancel</button>
              {err && <span className="adddocs-err" role="alert">{err}</span>}
            </div>
          </form>
        )}
      </section>

      <section>
        <h3>FICA</h3>
        <form action={saveFica} className="fica-form">
          <label>Status
            <select name="status" defaultValue={party.fica?.status ?? "outstanding"}>
              {FICA_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Risk
            <select name="risk" defaultValue={party.fica?.risk ?? "low"}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="wide">Source of funds{party.side === "purchaser" ? "" : " (if relevant)"}<input name="source_of_funds" defaultValue={party.fica?.sourceOfFunds ?? ""} /></label>
          <label className="wide">Notes<textarea name="notes" rows={2} defaultValue={party.fica?.notes ?? ""} /></label>
          <div className="fica-form-go wide">
            <button className="btn-secondary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save FICA"}</button>
            {party.fica?.verifiedAt && <span className="fica-sub">Verified {day(party.fica.verifiedAt)}</span>}
            {ficaErr && <span className="adddocs-err" role="alert">{ficaErr}</span>}
          </div>
        </form>
      </section>
    </article>
  );
}
