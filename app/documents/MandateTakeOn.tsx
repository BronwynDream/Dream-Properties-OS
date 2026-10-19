"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AddSellerFields, { emptySeller, normaliseSeller, type SellerFormValue } from "@/app/properties/AddSellerFields";
import dynamic from "next/dynamic";
import { locateErf, mandateContext, propertyForErf, takeOnForMandate, type TakeOnProperty } from "./actions";
import type { StartProperty } from "./DocumentStart";
import type { MapErf, MapFocus, MapJump } from "./ErfPickerMap";
import { SUBURBS } from "./suburbs";

// Mapbox touches window on import, so the picker map loads in the browser only.
const ErfPickerMap = dynamic(() => import("./ErfPickerMap"), { ssr: false });

// Mandate take-on on the Documents page (2026-10-19). Taking on the mandate
// is usually what creates the property, so this asks for the property and
// the seller, finds or creates the record, and opens the mandate editor.
// Price, commission and dates stay in the editor, next to its preview.

type RollHit = {
  sgNumber: string;
  erfNumber: string;
  streetNo: string | null;
  streetName: string;
  suburb: string | null;
  extentSqm: number | null;
  titleDeedNo: string | null;
};

type Chosen = { label: string; sub: string | null; property: TakeOnProperty; existingId: string | null };

const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : s;
const rollAddress = (h: RollHit) => titleCase([h.streetNo, h.streetName].filter(Boolean).join(" "));
const groupDigits = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export default function MandateTakeOn({
  type,
  properties,
  mapboxToken,
}: {
  type: "exclusive" | "joint" | "open" | null;
  properties: StartProperty[];
  mapboxToken: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [roll, setRoll] = useState<RollHit[]>([]);
  const [rollBusy, setRollBusy] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [jump, setJump] = useState<MapJump>(null);
  const [onRecord, setOnRecord] = useState<string[] | null>(null);
  const [seller, setSeller] = useState<SellerFormValue>(emptySeller);
  const [sellerOpen, setSellerOpen] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = query.trim();

  const inOs = useMemo(() => {
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    return properties
      .filter((p) => `${p.address} ${p.suburb ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.address.localeCompare(b.address))
      .slice(0, 5);
  }, [properties, q]);

  // A suburb typed in the search: offer to show it on the map.
  const suburbHits = useMemo(() => {
    if (q.length < 3 || /^\d/.test(q)) return [];
    const needle = q.toLowerCase();
    return SUBURBS.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 3);
  }, [q]);

  // The municipal roll: every erf in Knysna, searched by street.
  useEffect(() => {
    if (chosen || q.length < 4 || !/[a-z]/i.test(q)) {
      setRoll([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setRollBusy(true);
      try {
        const res = await fetch(`/api/erf-lookup?address=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { ok: boolean; candidates?: RollHit[]; parsed?: { streetNo: string | null } };
        if (!live) return;
        const no = body.parsed?.streetNo ?? null;
        const hits = (body.candidates ?? []).filter((c) => !no || c.streetNo === no);
        setRoll(hits.slice(0, 6));
      } catch {
        if (live) setRoll([]);
      } finally {
        if (live) setRollBusy(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, chosen]);

  // On an existing record, see whether the seller is already captured.
  useEffect(() => {
    setOnRecord(null);
    if (!chosen?.existingId) return;
    let live = true;
    mandateContext(chosen.existingId).then((r) => {
      if (!live || !r.ok) return;
      setOnRecord(r.sellerNames);
      setSellerOpen(r.sellerNames.length === 0);
    });
    return () => {
      live = false;
    };
  }, [chosen]);

  function pick(c: Chosen, at?: MapFocus) {
    setChosen(c);
    setErr(null);
    setSeller(emptySeller);
    setSellerOpen(true);
    // Show it on the map: where the record or the click says, else find the erf.
    if (at) {
      setFocus(at);
      return;
    }
    const p = c.existingId ? properties.find((x) => x.id === c.existingId) : null;
    if (p?.lat != null && p?.lng != null) {
      setFocus({ lng: p.lng, lat: p.lat, prclKey: null });
      return;
    }
    if (c.property.kind === "erf") {
      locateErf(c.property.erfNumber).then((hit) => setFocus(hit ? { lng: hit.lng, lat: hit.lat, prclKey: hit.prclKey } : null));
    }
  }

  // An erf clicked on the map: its Dream OS record if it has one, else a new one from the roll.
  async function pickFromMap(e: MapErf) {
    const at: MapFocus = { lng: e.lng, lat: e.lat, prclKey: e.prclKey };
    const owner = await propertyForErf(e.sgNumber, e.erfNumber);
    if (owner) {
      pick(
        { label: owner.address, sub: owner.suburb ?? "already in Dream OS", property: { kind: "existing", propertyId: owner.id }, existingId: owner.id },
        at,
      );
      return;
    }
    const suburb = e.suburb ? titleCase(e.suburb) : null;
    const address = e.address ? titleCase(e.address) : `Erf ${e.erfNumber}${suburb ? `, ${suburb}` : ""}`;
    pick(
      {
        label: address,
        sub: [`Erf ${e.erfNumber}`, suburb, "new record"].filter(Boolean).join(" · "),
        property: {
          kind: "erf",
          erfNumber: e.erfNumber,
          sgNumber: e.sgNumber,
          address,
          suburb,
          extentSqm: e.extentSqm,
          titleDeedNo: e.titleDeedNo,
        },
        existingId: null,
      },
      at,
    );
  }

  const sellerValue = sellerOpen ? normaliseSeller(seller) : null;
  const sellerReady = !!sellerValue || (!!onRecord && onRecord.length > 0);
  const ready = !!type && !!chosen && sellerReady && !pending;

  function go() {
    if (!type || !chosen) return;
    setErr(null);
    const s = sellerValue;
    start(async () => {
      const res = await takeOnForMandate({
        property: chosen.property,
        seller: s
          ? {
              party_type: s.partyType,
              full_name: s.fullName || null,
              id_number: s.idNumber || null,
              passport_no: s.passportNo || null,
              matrimonial_regime: s.matrimonialRegime,
              entity_name: s.entityName || null,
              registration_no: s.registrationNo || null,
              email: s.email || null,
              phone: s.phone || null,
            }
          : null,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.push(`/properties/${res.propertyId}/documents/mandate/new?type=${type}&listing=${res.listingId}`);
    });
  }

  return (
    <>
      <div className="takeon-where">
      <fieldset className="docstart-step">
        <legend>Which property?</legend>
        {chosen ? (
          <div className="docstart-chosen">
            <span>
              <b>{chosen.label}</b>
              {chosen.sub && <span className="docstart-sub"> · {chosen.sub}</span>}
            </span>
            <button
              type="button"
              className="docstart-link"
              onClick={() => {
                setChosen(null);
                setFocus(null);
              }}
              disabled={pending}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              className="docstart-search"
              placeholder="Street address or suburb, e.g. 12 Eagles Way or Leisure Isle"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Property address"
              autoFocus
            />
            {q.length < 2 ? (
              <p className="docstart-note">
                Type the address, or find the property on the map and click its erf. If it&apos;s already in
                Dream OS you&apos;ll get its record; if not, it&apos;s created for you.
              </p>
            ) : (
              <div className="docstart-results">
                {suburbHits.length > 0 && (
                  <div>
                    <p className="docstart-group">Suburb · show it on the map, then click the erf</p>
                    <div className="docstart-suburbs">
                      {suburbHits.map((s) => (
                        <button
                          key={s.name}
                          type="button"
                          className="docstart-suburb"
                          onClick={() => setJump({ lng: s.lng, lat: s.lat, zoom: 15.5, key: Date.now() })}
                        >
                          {s.name} →
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {inOs.length > 0 && (
                  <div>
                    <p className="docstart-group">Already in Dream OS</p>
                    <ul className="docstart-props" role="list">
                      {inOs.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() =>
                              pick({ label: p.address, sub: p.suburb, property: { kind: "existing", propertyId: p.id }, existingId: p.id })
                            }
                          >
                            <span className="docstart-addr">{p.address}</span>
                            <span className="docstart-sub">{p.suburb ?? ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {roll.length > 0 && (
                  <div>
                    <p className="docstart-group">Municipal roll · a new record, with the erf attached</p>
                    <ul className="docstart-props" role="list">
                      {roll.map((h) => (
                        <li key={h.sgNumber}>
                          <button
                            type="button"
                            onClick={() =>
                              pick({
                                label: rollAddress(h),
                                sub: [`Erf ${h.erfNumber}`, h.suburb ? titleCase(h.suburb) : null].filter(Boolean).join(" · "),
                                property: {
                                  kind: "erf",
                                  erfNumber: h.erfNumber,
                                  sgNumber: h.sgNumber,
                                  address: rollAddress(h),
                                  suburb: h.suburb ? titleCase(h.suburb) : null,
                                  extentSqm: h.extentSqm,
                                  titleDeedNo: h.titleDeedNo,
                                },
                                existingId: null,
                              })
                            }
                          >
                            <span className="docstart-addr">{rollAddress(h)}</span>
                            <span className="docstart-sub">
                              Erf {h.erfNumber}
                              {h.suburb ? ` · ${titleCase(h.suburb)}` : ""}
                              {h.extentSqm ? ` · ${groupDigits(Number(h.extentSqm))} m²` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {rollBusy && roll.length === 0 && <p className="docstart-note">Checking the municipal roll…</p>}

                <button
                  type="button"
                  className="docstart-new"
                  onClick={() => pick({ label: q, sub: "new property", property: { kind: "new", address: q }, existingId: null })}
                >
                  Not listed? Create <b>{q}</b> as a new property
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>

        <ErfPickerMap token={mapboxToken} focus={focus} jump={jump} onPick={pickFromMap} />
      </div>

      {chosen && (
        <fieldset className="docstart-step">
          <legend>The seller</legend>
          {chosen.existingId && onRecord === null ? (
            <p className="docstart-note">Checking the record…</p>
          ) : (
            <>
              {onRecord && onRecord.length > 0 && (
                <p className="docstart-onrecord">
                  On the record: <b>{onRecord.join(" and ")}</b>.{" "}
                  {!sellerOpen && (
                    <button type="button" className="docstart-link" onClick={() => setSellerOpen(true)}>
                      Add another seller
                    </button>
                  )}
                </p>
              )}
              {(sellerOpen || !onRecord?.length) && (
                <AddSellerFields
                  value={seller}
                  onChange={setSeller}
                  open={sellerOpen}
                  onOpenChange={setSellerOpen}
                  disabled={pending}
                />
              )}
            </>
          )}
        </fieldset>
      )}

      <div className="docstart-go">
        <button type="button" className="btn-primary" disabled={!ready} onClick={go}>
          {pending ? "Opening the mandate…" : "Continue to the mandate"}
        </button>
        {!type && <p className="docstart-note">Choose the kind of mandate first.</p>}
        {err && <p className="docstart-err">{err}</p>}
      </div>
    </>
  );
}
