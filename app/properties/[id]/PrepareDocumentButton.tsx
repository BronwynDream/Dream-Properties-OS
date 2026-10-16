"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createDraft } from "@/app/documents/[id]/actions";

// "Prepare document…" on the property record (plan 019 Arc A4): the deal
// documents from the clause library that are not mandates. Picking one
// creates a draft pre-filled from the property and its active transfer and
// opens the editor. Mandates have their own button next door.

const TEMPLATES: { code: string; title: string; hint: string; needsTransfer: boolean; soon?: boolean }[] = [
  { code: "agreement_sale_house", title: "Agreement of sale — freehold house", hint: "Bronwyn's 2026 master, filled from the deal. Signed first, it is the offer.", needsTransfer: true },
  { code: "agreement_sale_sectional", title: "Agreement of sale — sectional title", hint: "Being loaded next.", needsTransfer: true, soon: true },
  { code: "agreement_sale_land", title: "Agreement of sale — vacant land", hint: "Being loaded next.", needsTransfer: true, soon: true },
  { code: "movables_agreement", title: "Movables agreement", hint: "Furniture and movables sold with the property.", needsTransfer: true },
  { code: "addendum_sale", title: "Addendum to agreement of sale", hint: "Amend named clauses of a signed agreement.", needsTransfer: true },
  { code: "addendum_movables", title: "Addendum to movables agreement", hint: "Amend a signed movables agreement.", needsTransfer: true },
  { code: "ppra_disclosure", title: "PPRA mandatory disclosure", hint: "Section 67 condition report, filled from the answers on this record.", needsTransfer: true },
  { code: "condition_report_appendix", title: "Condition report appendix", hint: "Seller unable to complete the Property Condition Report.", needsTransfer: true },
];

export default function PrepareDocumentButton({
  propertyId,
  transferId,
  listingId,
}: {
  propertyId: string;
  transferId: string | null;
  listingId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function go(code: string) {
    setOpen(false);
    setErr(null);
    start(async () => {
      const res = await createDraft({ templateCode: code, propertyId, transferId, listingId });
      // createDraft redirects on success; only an error returns.
      if (res && !res.ok) setErr(res.error);
    });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        style={{ padding: "8px 12px", fontSize: 13 }}
      >
        {pending ? "Preparing…" : "Prepare document…"}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)", padding: 6, zIndex: 20, minWidth: 320,
          }}
        >
          {TEMPLATES.map((t) => {
            const blocked = t.soon || (t.needsTransfer && !transferId);
            return (
              <button
                key={t.code}
                type="button"
                role="menuitem"
                onClick={() => go(t.code)}
                disabled={blocked}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                  background: "transparent", border: "none", borderRadius: 6, cursor: blocked ? "not-allowed" : "pointer",
                  opacity: blocked ? 0.5 : 1,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                <div style={{ fontSize: 11, color: "var(--paper-mute)" }}>
                  {t.soon ? t.hint : blocked ? "Needs a deal on this property first." : t.hint}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {err && <p style={{ position: "absolute", right: 0, fontSize: 12, color: "#B8434B", whiteSpace: "nowrap" }}>{err}</p>}
    </div>
  );
}
