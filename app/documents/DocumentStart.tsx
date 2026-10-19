"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraft } from "@/app/documents/[id]/actions";
import MandateTakeOn from "./MandateTakeOn";

// The Documents start page's two questions (2026-10-19): what are you
// making, and which property is it for. Bronwyn's eleven templates fall into
// five families; each block opens a short panel underneath to pick the exact
// document and the property. Mandates go to the mandate editor; everything
// else is a deal document, created as a draft against the property's deal
// (the same createDraft the record's "Prepare document…" button uses).

export type StartProperty = {
  id: string;
  address: string;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  prclKey: string | null;
  listingId: string | null;
  transferId: string | null;
  mine: boolean;
};

type Variant = { code: string; title: string; hint: string };
type Family = {
  key: string;
  title: string;
  blurb: string;
  needsDeal: boolean;
  variants: Variant[];
};

const FAMILIES: Family[] = [
  {
    key: "mandate",
    title: "Mandate",
    blurb: "Take a property on to sell. Signed by the seller before marketing starts.",
    needsDeal: false,
    variants: [
      { code: "mandate:exclusive", title: "Exclusive", hint: "Dream is the only agency marketing the property." },
      { code: "mandate:joint", title: "Joint", hint: "Marketed with a co-mandated agency." },
      { code: "mandate:open", title: "Open", hint: "The seller may use any number of agents." },
    ],
  },
  {
    key: "sale",
    title: "Agreement of sale",
    blurb: "Bronwyn's 2026 master, filled from the deal. Signed by the buyer first, it is the offer.",
    needsDeal: true,
    variants: [
      { code: "agreement_sale_house", title: "Freehold house", hint: "A house on its own erf." },
      { code: "agreement_sale_sectional", title: "Sectional title", hint: "Section, scheme, levies and the body corporate." },
      { code: "agreement_sale_land", title: "Vacant land", hint: "A plot: no occupation, fixtures or certificates." },
    ],
  },
  {
    key: "movables",
    title: "Movables",
    blurb: "Furniture and contents sold with the property, on their own agreement.",
    needsDeal: true,
    variants: [{ code: "movables_agreement", title: "Movables agreement", hint: "The list of what's included, and its price." }],
  },
  {
    key: "addendum",
    title: "Addendum",
    blurb: "Change named clauses of an agreement that's already signed.",
    needsDeal: true,
    variants: [
      { code: "addendum_sale", title: "To the agreement of sale", hint: "Dates, price, conditions, occupation." },
      { code: "addendum_movables", title: "To the movables agreement", hint: "Items added, removed or repriced." },
    ],
  },
  {
    key: "disclosure",
    title: "Disclosure",
    blurb: "The PPRA paperwork that goes with every sale.",
    needsDeal: true,
    variants: [
      { code: "ppra_disclosure", title: "PPRA mandatory disclosure", hint: "Section 67 condition report, filled from the record's answers." },
      { code: "condition_report_appendix", title: "Condition report appendix", hint: "When the seller can't complete the condition report." },
    ],
  },
];

const SHOW = 8;

export default function DocumentStart({ properties, mapboxToken }: { properties: StartProperty[]; mapboxToken: string }) {
  const router = useRouter();
  const [familyKey, setFamilyKey] = useState<string | null>(null);
  const [variantCode, setVariantCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const family = FAMILIES.find((f) => f.key === familyKey) ?? null;
  const variant = family?.variants.find((v) => v.code === variantCode) ?? null;

  function choose(f: Family) {
    if (f.key === familyKey) {
      setFamilyKey(null);
      return;
    }
    setFamilyKey(f.key);
    setVariantCode(f.variants.length === 1 ? f.variants[0].code : null);
    setPropertyId(null);
    setErr(null);
  }

  // Deal documents can only be prepared on a property with a deal on it.
  const eligible = useMemo(
    () => properties.filter((p) => !family?.needsDeal || p.transferId),
    [properties, family],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? eligible.filter((p) => `${p.address} ${p.suburb ?? ""}`.toLowerCase().includes(q))
      : eligible.filter((p) => p.mine);
    return [...hits].sort((a, b) => Number(b.mine) - Number(a.mine) || a.address.localeCompare(b.address));
  }, [eligible, query]);
  const chosen = properties.find((p) => p.id === propertyId) ?? null;

  function prepare() {
    if (!variant || !chosen) return;
    setErr(null);
    if (variant.code.startsWith("mandate:")) {
      const params = new URLSearchParams({ type: variant.code.slice("mandate:".length) });
      if (chosen.listingId) params.set("listing", chosen.listingId);
      router.push(`/properties/${chosen.id}/documents/mandate/new?${params.toString()}`);
      return;
    }
    start(async () => {
      const res = await createDraft({
        templateCode: variant.code,
        propertyId: chosen.id,
        transferId: chosen.transferId,
        listingId: chosen.listingId,
      });
      // createDraft redirects to the editor on success; only an error returns.
      if (res && !res.ok) setErr(res.error);
    });
  }

  return (
    <div className="docstart">
      <ul className="docstart-grid" role="list">
        {FAMILIES.map((f) => {
          const on = f.key === familyKey;
          return (
            <li key={f.key}>
              <button
                type="button"
                className={`docstart-block${on ? " on" : ""}`}
                aria-expanded={on}
                aria-controls="docstart-panel"
                onClick={() => choose(f)}
              >
                <span className="docstart-title">{f.title}</span>
                <span className="docstart-blurb">{f.blurb}</span>
                <span className="docstart-kinds">{f.variants.map((v) => v.title).join(" · ")}</span>
                {f.needsDeal && <span className="docstart-needs">Needs a deal on the property</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {family && (
        <section id="docstart-panel" className="docstart-panel" aria-label={`Prepare ${family.title.toLowerCase()}`}>
          {family.variants.length > 1 && (
            <fieldset className="docstart-step">
              <legend>Which {family.key === "mandate" ? "mandate" : family.title.toLowerCase()}?</legend>
              <div className="docstart-variants">
                {family.variants.map((v) => (
                  <label key={v.code} className={`docstart-variant${variantCode === v.code ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="variant"
                      value={v.code}
                      checked={variantCode === v.code}
                      onChange={() => setVariantCode(v.code)}
                    />
                    <span className="docstart-variant-title">{v.title}</span>
                    <span className="docstart-variant-hint">{v.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {family.key === "mandate" ? (
            <MandateTakeOn
              key={family.key}
              type={variant ? (variant.code.slice("mandate:".length) as "exclusive" | "joint" | "open") : null}
              properties={properties}
              mapboxToken={mapboxToken}
            />
          ) : (
            <>
          <fieldset className="docstart-step">
            <legend>Which property?</legend>
            {chosen ? (
              <div className="docstart-chosen">
                <span>
                  <b>{chosen.address}</b>
                  {chosen.suburb && <span className="docstart-sub"> · {chosen.suburb}</span>}
                </span>
                <button type="button" className="docstart-link" onClick={() => setPropertyId(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  className="docstart-search"
                  placeholder="Search by address or suburb"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search properties"
                  autoFocus
                />
                {!query.trim() && matches.length > 0 && <p className="docstart-note">Your listings</p>}
                {matches.length > 0 ? (
                  <ul className="docstart-props" role="list">
                    {matches.slice(0, SHOW).map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => setPropertyId(p.id)}>
                          <span className="docstart-addr">{p.address}</span>
                          <span className="docstart-sub">{p.suburb ?? ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="docstart-note">
                    {query.trim()
                      ? family.needsDeal
                        ? "No property with a deal matches. Deal documents need a deal on the property first: open the property record to start one."
                        : "No property matches. Add it from Properties first."
                      : "Type an address or suburb to find the property."}
                  </p>
                )}
                {matches.length > SHOW && (
                  <p className="docstart-note">{matches.length - SHOW} more. Keep typing to narrow it down.</p>
                )}
              </>
            )}
          </fieldset>

          <div className="docstart-go">
            <button type="button" className="btn-primary" disabled={!variant || !chosen || pending} onClick={prepare}>
              {pending ? "Preparing…" : variant ? `Prepare ${labelFor(family, variant)}` : "Prepare"}
            </button>
            {err && <p className="docstart-err">{err}</p>}
          </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function labelFor(f: Family, v: Variant): string {
  if (f.key === "mandate") return `${v.title.toLowerCase()} mandate`;
  if (f.key === "sale") return `agreement of sale (${v.title.toLowerCase()})`;
  if (f.key === "addendum") return `addendum ${v.title.toLowerCase()}`;
  if (f.key === "movables") return "movables agreement";
  return v.title.startsWith("PPRA") ? v.title : v.title.toLowerCase();
}
