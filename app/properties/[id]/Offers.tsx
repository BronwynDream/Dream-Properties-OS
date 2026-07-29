"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createOffer, updateOffer, setOfferStatus, deleteOffer } from "./actions";
import { randString } from "@/app/components/format";

// Offers sub-panel on the Property Record.
//
// Two views:
//   List — one row per offer submitted on this transfer, most recent
//          first. Inline status changes (submit → counter → accept /
//          reject / withdraw / lapse). Estate-agency-design skill's
//          rule: accepting an offer does NOT auto-reject the others,
//          because a director may want a backup live in case
//          suspensive conditions fail.
//   Compare — side-by-side columns per non-terminal offer with rows
//             for amount / deposit / bond / sale-of-property / occupation /
//             expiry. Highest amount column gets a green tint; the offer
//             with fewest conditions gets a "★ cleanest" badge.
//
// The comparison-view rule Bronwyn hinted at: a lower unconditional
// offer can beat a higher bonded one. The panel makes both cells
// visible on the same row so the trade-off is legible.

export type OfferRow = {
  id: string;
  purchaserPartyId: string | null;
  purchaserName: string | null;
  amount: number | null;
  deposit: number | null;
  offerDate: string | null;
  status: "draft" | "submitted" | "countered" | "accepted" | "rejected" | "withdrawn" | "lapsed";
  conditionsSummary: string | null;
  notes: string | null;
  bondRequired: boolean | null;
  bondAmount: number | null;
  bondDays: number | null;
  saleOfPropertyRequired: boolean | null;
  saleOfPropertyDetails: string | null;
  depositDueDate: string | null;
  occupationDate: string | null;
  occupationalRentAmount: number | null;
  offerExpiresAt: string | null;
  extraConditions: string | null;
};

type Party = { id: string; display_name: string };

type Props = {
  propertyId: string;
  transferId: string;
  offers: OfferRow[];
  buyerCandidates: Party[]; // parties already on this transfer (buyer side)
};

export default function Offers({ propertyId, transferId, offers, buyerCandidates }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const live = offers.filter((o) => o.status !== "rejected" && o.status !== "withdrawn" && o.status !== "lapsed");

  return (
    <section style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-700, #423B31)" }}>
          <b>Offers</b>
          <span style={{ marginLeft: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}>
            {offers.length} on file · {live.length} live
          </span>
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          {live.length > 1 && (
            <button type="button" onClick={() => setShowCompare(!showCompare)} style={btnGhost}>
              {showCompare ? "Hide compare" : `Compare ${live.length} live`}
            </button>
          )}
          {!showForm && (
            <button type="button" onClick={() => setShowForm(true)} style={btnPrimary}>
              + New offer
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <OfferForm
          propertyId={propertyId}
          transferId={transferId}
          buyerCandidates={buyerCandidates}
          onDone={() => setShowForm(false)}
        />
      )}

      {showCompare && live.length > 1 && (
        <CompareView offers={live} propertyId={propertyId} />
      )}

      {offers.length === 0 && !showForm && (
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
          No offers captured yet.
        </p>
      )}

      {offers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {offers.map((o) => (
            <OfferListRow key={o.id} offer={o} propertyId={propertyId} />
          ))}
        </div>
      )}
    </section>
  );
}

// -------- list row --------

function OfferListRow({ offer, propertyId }: { offer: OfferRow; propertyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const stripe = statusStripe(offer.status);

  function move(to: OfferRow["status"]) {
    startTransition(async () => {
      await setOfferStatus({ id: offer.id, status: to, propertyId });
      router.refresh();
    });
  }

  function del() {
    if (!confirm("Delete this offer entirely?")) return;
    startTransition(async () => {
      await deleteOffer({ id: offer.id, propertyId });
      router.refresh();
    });
  }

  return (
    <div style={{ borderLeft: `3px solid ${stripe}`, background: "var(--paper-0, #FBF9F4)", padding: "10px 12px", borderRadius: "0 4px 4px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 16, fontWeight: 700, color: "var(--estuary, #132B84)" }}>
              R {offer.amount != null ? randString(offer.amount) : "—"}
            </span>
            <StatusPill status={offer.status} />
            {offer.bondRequired === false && (
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", background: "var(--status-active-bg)", color: "var(--status-active-fg)", borderRadius: 2, fontWeight: 600 }}>
                Cash
              </span>
            )}
            {offer.bondRequired === true && (
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", background: "var(--status-under-offer-bg)", color: "var(--status-under-offer-fg)", borderRadius: 2, fontWeight: 600 }}>
                Bond{offer.bondDays ? ` · ${offer.bondDays}d` : ""}
              </span>
            )}
            {offer.saleOfPropertyRequired && (
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", background: "var(--status-under-offer-bg)", color: "var(--status-under-offer-fg)", borderRadius: 2, fontWeight: 600 }}>
                Sell property
              </span>
            )}
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-700, #423B31)" }}>
            {offer.purchaserPartyId ? (
              <Link href={`/contacts/${offer.purchaserPartyId}`} style={{ color: "var(--estuary, #132B84)", fontWeight: 500 }}>
                {offer.purchaserName ?? "Unknown"}
              </Link>
            ) : (
              <span>{offer.purchaserName ?? "Purchaser TBD"}</span>
            )}
            <span style={{ marginLeft: 8, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.06em" }}>
              {offer.offerDate ?? "no date"}
              {offer.offerExpiresAt && ` · expires ${offer.offerExpiresAt.slice(0, 10)}`}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "flex-end" }}>
          <button type="button" onClick={() => setExpanded(!expanded)} style={btnGhost}>
            {expanded ? "Collapse" : "Details"}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--paper-1, #F5F1E8)", borderRadius: 4 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0, fontSize: 12 }}>
            <DetailRow label="Deposit"        value={offer.deposit != null ? `R ${randString(offer.deposit)}` : "—"} />
            <DetailRow label="Deposit due"    value={offer.depositDueDate ?? "—"} />
            <DetailRow label="Bond amount"    value={offer.bondAmount != null ? `R ${randString(offer.bondAmount)}` : "—"} />
            <DetailRow label="Occupation"     value={offer.occupationDate ?? "—"} />
            <DetailRow label="Occ. rent"      value={offer.occupationalRentAmount != null ? `R ${randString(offer.occupationalRentAmount)} / month` : "—"} />
            {offer.saleOfPropertyRequired && (
              <DetailRow label="Sell first"  value={offer.saleOfPropertyDetails ?? "—"} />
            )}
            {offer.conditionsSummary && <DetailRow label="Conditions" value={offer.conditionsSummary} />}
            {offer.extraConditions && <DetailRow label="Other" value={offer.extraConditions} />}
            {offer.notes && <DetailRow label="Notes" value={offer.notes} />}
          </dl>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {offer.status !== "accepted" && (
              <button type="button" onClick={() => move("accepted")} disabled={pending} style={btnPositive}>Accept</button>
            )}
            {offer.status !== "countered" && (
              <button type="button" onClick={() => move("countered")} disabled={pending} style={btnGhost}>Countered</button>
            )}
            {offer.status !== "rejected" && (
              <button type="button" onClick={() => move("rejected")} disabled={pending} style={btnGhost}>Reject</button>
            )}
            {offer.status !== "withdrawn" && (
              <button type="button" onClick={() => move("withdrawn")} disabled={pending} style={btnGhost}>Buyer withdrew</button>
            )}
            <button type="button" onClick={del} disabled={pending} style={btnDanger}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--paper-mute, #6a7692)" }}>{label}</dt>
      <dd style={{ margin: 0, color: "var(--ink-700, #423B31)" }}>{value}</dd>
    </>
  );
}

function StatusPill({ status }: { status: OfferRow["status"] }) {
  const tone: Record<OfferRow["status"], { bg: string; fg: string; label: string }> = {
    draft:      { bg: "var(--status-draft-bg)",       fg: "var(--status-draft-fg)",       label: "Draft" },
    submitted:  { bg: "var(--status-under-offer-bg)", fg: "var(--status-under-offer-fg)", label: "Submitted" },
    countered:  { bg: "var(--status-under-offer-bg)", fg: "var(--status-under-offer-fg)", label: "Countered" },
    accepted:   { bg: "var(--status-active-bg)",      fg: "var(--status-active-fg)",      label: "Accepted" },
    rejected:   { bg: "var(--status-withdrawn-bg)",   fg: "var(--status-withdrawn-fg)",   label: "Rejected" },
    withdrawn:  { bg: "var(--status-draft-bg)",       fg: "var(--status-draft-fg)",       label: "Withdrawn" },
    lapsed:     { bg: "var(--status-draft-bg)",       fg: "var(--status-draft-fg)",       label: "Lapsed" },
  };
  const t = tone[status];
  return (
    <span style={{ padding: "2px 8px", background: t.bg, color: t.fg, borderRadius: 3, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
      {t.label}
    </span>
  );
}

function statusStripe(status: OfferRow["status"]): string {
  if (status === "accepted") return "var(--positive, #4B6B4A)";
  if (status === "rejected" || status === "withdrawn" || status === "lapsed") return "var(--ink-400, #8C8172)";
  if (status === "countered") return "var(--caution, #A9772F)";
  return "var(--accent-600, #132B84)";
}

// -------- compare view --------

function CompareView({ offers, propertyId: _propertyId }: { offers: OfferRow[]; propertyId: string }) {
  // Ranking helpers.
  const maxAmount = Math.max(...offers.map((o) => o.amount ?? 0));
  const conditionCount = (o: OfferRow) =>
    (o.bondRequired ? 1 : 0) + (o.saleOfPropertyRequired ? 1 : 0) + (o.extraConditions?.trim() ? 1 : 0);
  const minConditions = Math.min(...offers.map(conditionCount));

  return (
    <div style={{ marginBottom: 12, padding: "12px 14px", background: "var(--paper-1, #F5F1E8)", border: "1px solid var(--line-soft, #E7E0D2)", borderRadius: 4, overflowX: "auto" }}>
      <p style={{ margin: "0 0 10px", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--paper-mute, #6a7692)" }}>
        Side-by-side · {offers.length} live offers
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 500 + offers.length * 160 }}>
        <thead>
          <tr>
            <th style={compareHeader}> </th>
            {offers.map((o) => (
              <th
                key={o.id}
                style={{
                  ...compareHeader,
                  background: o.amount === maxAmount ? "var(--status-active-bg)" : "transparent",
                  color: "var(--estuary, #132B84)",
                  minWidth: 150,
                }}
              >
                {o.purchaserName ?? "Purchaser"}
                {conditionCount(o) === minConditions && (
                  <span style={{ display: "block", marginTop: 2, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, color: "var(--positive)", letterSpacing: "0.06em", fontWeight: 600 }}>
                    ★ Cleanest
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <CompareRow label="Amount" render={(o) => (
            <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, color: o.amount === maxAmount ? "var(--positive)" : "var(--estuary, #132B84)" }}>
              R {o.amount != null ? randString(o.amount) : "—"}
            </span>
          )} offers={offers} />
          <CompareRow label="Deposit" render={(o) => o.deposit != null ? `R ${randString(o.deposit)}` : "—"} offers={offers} />
          <CompareRow label="Cash / bonded" render={(o) => o.bondRequired === false ? "Cash" : o.bondRequired === true ? `Bond${o.bondDays ? ` · ${o.bondDays}d` : ""}` : "—"} offers={offers} />
          <CompareRow label="Bond amount" render={(o) => o.bondAmount != null ? `R ${randString(o.bondAmount)}` : "—"} offers={offers} />
          <CompareRow label="Sell property first" render={(o) => o.saleOfPropertyRequired ? (o.saleOfPropertyDetails ?? "Yes") : "No"} offers={offers} />
          <CompareRow label="Occupation" render={(o) => o.occupationDate ?? "—"} offers={offers} />
          <CompareRow label="Occ. rent" render={(o) => o.occupationalRentAmount != null ? `R ${randString(o.occupationalRentAmount)}/mo` : "—"} offers={offers} />
          <CompareRow label="Offer expires" render={(o) => o.offerExpiresAt ? o.offerExpiresAt.slice(0, 10) : "—"} offers={offers} />
          <CompareRow label="Status" render={(o) => <StatusPill status={o.status} />} offers={offers} />
        </tbody>
      </table>
    </div>
  );
}

function CompareRow({ label, render, offers }: { label: string; render: (o: OfferRow) => React.ReactNode; offers: OfferRow[] }) {
  return (
    <tr>
      <td style={compareLabel}>{label}</td>
      {offers.map((o) => (
        <td key={o.id} style={compareCell}>
          {render(o)}
        </td>
      ))}
    </tr>
  );
}

// -------- new-offer form --------

function OfferForm({
  propertyId,
  transferId,
  buyerCandidates,
  onDone,
}: {
  propertyId: string;
  transferId: string;
  buyerCandidates: Party[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [purchaserPartyId, setPurchaserPartyId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [bond, setBond] = useState<"cash" | "bond" | "unknown">("unknown");
  const [bondAmount, setBondAmount] = useState("");
  const [bondDays, setBondDays] = useState("30");
  const [sellFirst, setSellFirst] = useState(false);
  const [sellFirstDetails, setSellFirstDetails] = useState("");
  const [occupation, setOccupation] = useState("");
  const [occRent, setOccRent] = useState("");
  const [offerDate, setOfferDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState("");
  const [conditionsSummary, setConditionsSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!amount || !Number.isFinite(Number(amount))) {
      setErr("Amount required");
      return;
    }
    startTransition(async () => {
      const res = await createOffer({
        propertyId,
        transferId,
        purchaserPartyId: purchaserPartyId || null,
        amount,
        deposit: deposit || null,
        bondRequired: bond === "bond" ? true : bond === "cash" ? false : null,
        bondAmount: bond === "bond" ? bondAmount || null : null,
        bondDays: bond === "bond" ? Number(bondDays) || null : null,
        saleOfPropertyRequired: sellFirst,
        saleOfPropertyDetails: sellFirst ? sellFirstDetails : null,
        occupationDate: occupation || null,
        occupationalRentAmount: occRent || null,
        offerDate,
        offerExpiresAt: expiresAt || null,
        conditionsSummary: conditionsSummary || null,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <div style={{ padding: 12, background: "var(--paper-1, #F5F1E8)", border: "1px dashed var(--line-strong, #D8CFBE)", borderRadius: 4, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label style={labelStyle}>
          Purchaser
          <select value={purchaserPartyId} onChange={(e) => setPurchaserPartyId(e.target.value)} disabled={pending} style={inputStyle}>
            <option value="">— none / walk-in —</option>
            {buyerCandidates.map((b) => (
              <option key={b.id} value={b.id}>{b.display_name}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Amount (R)
          <input type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending} style={inputStyle} placeholder="4500000" />
        </label>
        <label style={labelStyle}>
          Deposit (R)
          <input type="number" min={0} step={1} value={deposit} onChange={(e) => setDeposit(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Cash or bond?
          <select value={bond} onChange={(e) => setBond(e.target.value as "cash" | "bond" | "unknown")} disabled={pending} style={inputStyle}>
            <option value="unknown">Unknown</option>
            <option value="cash">Cash</option>
            <option value="bond">Bond required</option>
          </select>
        </label>
        {bond === "bond" && (
          <>
            <label style={labelStyle}>
              Bond amount (R)
              <input type="number" min={0} step={1} value={bondAmount} onChange={(e) => setBondAmount(e.target.value)} disabled={pending} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Bond days
              <input type="number" min={1} step={1} value={bondDays} onChange={(e) => setBondDays(e.target.value)} disabled={pending} style={inputStyle} />
            </label>
          </>
        )}
        <label style={labelStyle}>
          Occupation date
          <input type="date" value={occupation} onChange={(e) => setOccupation(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Occ. rent / month (R)
          <input type="number" min={0} step={1} value={occRent} onChange={(e) => setOccRent(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Offer date
          <input type="date" value={offerDate} onChange={(e) => setOfferDate(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Offer expires
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink-700, #423B31)" }}>
          <input type="checkbox" checked={sellFirst} onChange={(e) => setSellFirst(e.target.checked)} disabled={pending} />
          Subject to sale of purchaser&apos;s property
        </label>
        {sellFirst && (
          <input type="text" value={sellFirstDetails} onChange={(e) => setSellFirstDetails(e.target.value)} placeholder="Property + deadline" disabled={pending} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        )}
      </div>
      <label style={{ ...labelStyle, marginTop: 10 }}>
        Conditions / notes
        <textarea value={conditionsSummary} onChange={(e) => setConditionsSummary(e.target.value)} disabled={pending} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Any additional suspensive conditions the buyer wrote in" />
      </label>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" onClick={submit} disabled={pending} style={btnPrimary}>
          {pending ? "Saving…" : "Capture offer"}
        </button>
        <button type="button" onClick={onDone} disabled={pending} style={btnGhost}>Cancel</button>
      </div>
      {err && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--critical, #9A3B34)" }}>{err}</p>}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "5px 12px", background: "var(--estuary, #132B84)", color: "var(--paper-0, #FBF9F4)", border: "none", borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "5px 10px", background: "transparent", color: "var(--estuary, #132B84)", border: "1px solid var(--estuary, #132B84)", borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  ...btnGhost, color: "var(--critical, #9A3B34)", border: "1px solid var(--critical, #9A3B34)",
};
const btnPositive: React.CSSProperties = {
  ...btnGhost, color: "var(--positive, #4B6B4A)", border: "1px solid var(--positive, #4B6B4A)",
};
const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--paper-mute, #6a7692)",
};
const inputStyle: React.CSSProperties = {
  padding: "5px 8px", border: "1px solid var(--line-strong, #D8CFBE)", borderRadius: 3,
  fontFamily: "inherit", fontSize: 12, background: "var(--paper-0, #FBF9F4)", width: "100%",
};
const compareHeader: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--ink-500, #6B6153)", borderBottom: "1px solid var(--line-strong, #D8CFBE)",
};
const compareLabel: React.CSSProperties = {
  padding: "6px 10px", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--paper-mute, #6a7692)", borderBottom: "1px solid var(--line-soft, #E7E0D2)", whiteSpace: "nowrap",
};
const compareCell: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12, color: "var(--ink-700, #423B31)", borderBottom: "1px solid var(--line-soft, #E7E0D2)", verticalAlign: "top",
};
