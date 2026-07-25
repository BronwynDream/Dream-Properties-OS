import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MergeTransfer from "./MergeTransfer";
import MarkSoldButton from "./MarkSoldButton";
import PropertyHero, { type SinceLine } from "./PropertyHero";
import PhotoLightbox from "./PhotoLightbox";
import DropZone from "@/app/triage/DropZone";
import LightstoneFetch from "./LightstoneFetch";
import ErfLookup from "./ErfLookup";
import { PRODUCTS as LIGHTSTONE_PRODUCTS } from "@/lib/lightstone";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function money(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `R ${n.toLocaleString("en-ZA")}` : "—";
}

export default async function PropertyRecord({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const { data: prop } = await supabase
    .from("property")
    .select(
      "*, suburb:suburb_id(name), ownership_type:ownership_type_id(label), property_type:property_type_id(label)",
    )
    .eq("id", params.id)
    .single();
  if (!prop) notFound();

  const { data: erven } = await supabase
    .from("erf")
    .select("erf_number, portion, sg_number")
    .eq("property_id", params.id);

  // Muni mirror data for each erven assigned to this property. Join priority:
  //   1. sg_number (exact, unambiguous — populated when the erf was attached
  //      via the muni-picker UI)
  //   2. erf_number fallback (for legacy / LLM-extracted erfs with no SG).
  //      Erf numbers repeat across Knysna suburbs (2934 exists in Sedgefield
  //      AND on The Heads), so this fallback WILL show extra cards for those
  //      cases. Fix: re-attach via muni picker to populate sg_number.
  const ervenRows = (erven ?? []) as { erf_number: string; sg_number: string | null }[];
  const sgNumbers = ervenRows.map((e) => e.sg_number).filter(Boolean) as string[];
  const erfsWithoutSg = ervenRows.filter((e) => !e.sg_number).map((e) => e.erf_number).filter(Boolean);

  const muniSelect =
    "sg_number, erf_number, muni_erf_code, street_no, street_name, suburb_hint, suburb, tariff, muni_valuation, zoning, ward_no, sectional_title_flag, usage_, prop_description, town_name, area_sqm_valroll, extent_sqm, property_type, sect_scheme_name, sect_scheme_unit, title_deed_no, old_title_deed_no, deeds_office, purch_date, registration_date, purch_price, bond_number, bond_amount, bond_institution, refreshed_at";

  const muniBySg = sgNumbers.length
    ? (await supabase.from("muni_property").select(muniSelect).in("sg_number", sgNumbers)).data ?? []
    : [];
  const muniByErf = erfsWithoutSg.length
    ? (await supabase.from("muni_property").select(muniSelect).in("erf_number", erfsWithoutSg)).data ?? []
    : [];
  // De-dupe by sg_number in case an erf_number match also came through SG.
  const seenSgs = new Set<string>();
  const muniRecords: any[] = [];
  for (const row of [...muniBySg, ...muniByErf]) {
    const key = (row as any).sg_number;
    if (!key || seenSgs.has(key)) continue;
    seenSgs.add(key);
    muniRecords.push(row);
  }

  // Try the post-0033 schema first (sold_by, sold_by_note). If those columns
  // don't yet exist in this environment (migration not applied), fall back to
  // the legacy select — otherwise the page silently renders as if the property
  // had no transfers at all, which looks like data loss but isn't. Typed as
  // any[] because the two selects have different shapes and downstream code
  // only cares that the fields present at read-time are present.
  let transfersData: any[] | null = null;
  const primary = await supabase
    .from("transfer")
    .select("id, name, status, transfer_date, registered_date, created_at, sold_by, sold_by_note")
    .eq("property_id", params.id)
    .order("created_at", { ascending: false });
  if (primary.error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[property] transfer select failed, retrying without 0033 columns: ${primary.error.message}`,
    );
    const legacy = await supabase
      .from("transfer")
      .select("id, name, status, transfer_date, registered_date, created_at")
      .eq("property_id", params.id)
      .order("created_at", { ascending: false });
    transfersData = legacy.data as any[] | null;
  } else {
    transfersData = primary.data as any[] | null;
  }
  const transfers = (transfersData ?? []) as any[];
  const tids = transfers.map((t) => t.id);

  const { data: tpartiesData } = tids.length
    ? await supabase
        .from("transfer_party")
        .select(
          "transfer_id, side, is_primary, party:party_id(id, display_name, entity_name, party_type, registration_no, id_number)",
        )
        .in("transfer_id", tids)
    : { data: [] };
  const tparties = (tpartiesData ?? []) as any[];

  const { data: agreementsData } = tids.length
    ? await supabase.from("agreement").select("*").in("transfer_id", tids)
    : { data: [] };
  const agreements = (agreementsData ?? []) as any[];

  const { data: milestonesData } = tids.length
    ? await supabase
        .from("milestone")
        .select("transfer_id, type, due_date, status")
        .in("transfer_id", tids)
    : { data: [] };
  const milestones = (milestonesData ?? []) as any[];

  const partyIds = Array.from(new Set(tparties.map((tp) => tp.party?.id).filter(Boolean)));
  const { data: membersData } = partyIds.length
    ? await supabase
        .from("party_member")
        .select("entity_party_id, role, member:member_party_id(display_name, id_number)")
        .in("entity_party_id", partyIds)
    : { data: [] };
  const members = (membersData ?? []) as any[];

  const membersFor = (pid: string) => members.filter((m) => m.entity_party_id === pid);

  // Documents linked to these transfers, with short-lived signed URLs to view them.
  // Now including doc_type.category + mime_type so we can group and identify photos.
  const { data: docLinksData } = tids.length
    ? await supabase
        .from("document_link")
        .select(
          "entity_id, document:document_id(id, title, storage_bucket, storage_path, mime_type, is_pii, doc_type:doc_type_id(label, category, code))",
        )
        .eq("entity_type", "transfer")
        .in("entity_id", tids)
    : { data: [] };
  const docLinks = (docLinksData ?? []) as any[];
  type DocRow = {
    transfer_id: string;
    id: string;
    title: string;
    label: string | null;
    code: string | null;
    category: string;
    mime_type: string | null;
    is_pii: boolean;
    url: string | null;
    isImage: boolean;
  };
  const docs: DocRow[] = [];
  const seenIds = new Set<string>();
  for (const dl of docLinks) {
    const d = dl.document;
    if (!d) continue;
    // Deduplicate at read time as well — a document linked to multiple transfers
    // (post-dedupe) shows up once per transfer link. Show it under the first.
    const dedupeKey = `${d.id}::${dl.entity_id}`;
    if (seenIds.has(dedupeKey)) continue;
    seenIds.add(dedupeKey);

    const { data: signed, error: signErr } = d.storage_bucket && d.storage_path
      ? await supabase.storage.from(d.storage_bucket).createSignedUrl(d.storage_path, 3600)
      : { data: null, error: null };
    if (signErr) {
      console.error(`[property] signed URL failed for doc ${d.id} (${d.title}):`, signErr.message);
    }
    // isImage drives the Photos strip below the deal card. Strict on purpose:
    // only files whose doc_type is 'photo'. Scanned IDs / passports would be
    // image files too but they belong to fica category — surfacing them in a
    // public strip is a POPIA problem, so the doc-chip renderer handles them
    // as text chips instead.
    const isImage = d.doc_type?.code === "photo";
    docs.push({
      transfer_id: dl.entity_id,
      id: d.id,
      title: d.title,
      label: d.doc_type?.label ?? null,
      code: d.doc_type?.code ?? null,
      category: d.doc_type?.category ?? "other",
      mime_type: d.mime_type ?? null,
      is_pii: d.is_pii,
      url: signed?.signedUrl ?? null,
      isImage,
    });
  }

  // Photos aggregated across all transfers for the top strip.
  const propertyPhotos = docs.filter((d) => d.isImage);
  // Dedupe across transfers by document id — the same photo linked to two
  // transfers should only show once in the strip.
  const seenPhotoIds = new Set<string>();
  const uniquePhotos: DocRow[] = [];
  for (const p of propertyPhotos) {
    if (seenPhotoIds.has(p.id)) continue;
    seenPhotoIds.add(p.id);
    uniquePhotos.push(p);
  }

  // Category rendering order — most important first.
  const CATEGORY_ORDER: { key: string; label: string }[] = [
    { key: "mandate", label: "Mandate" },
    { key: "agreement", label: "Agreement" },
    { key: "listing", label: "Listing" },
    { key: "compliance", label: "Compliance" },
    { key: "fica", label: "FICA" },
    { key: "municipal", label: "Municipal" },
    { key: "plan", label: "Plans" },
    { key: "company", label: "Company / Juristic" },
    { key: "correspondence", label: "Correspondence" },
    { key: "other", label: "Other" },
  ];

  const docsFor = (tid: string) => docs.filter((x) => x.transfer_id === tid && !x.isImage);
  const groupedDocsFor = (tid: string) => {
    const all = docsFor(tid);
    return CATEGORY_ORDER.map((cat) => ({
      ...cat,
      items: all.filter((d) => d.category === cat.key),
    })).filter((g) => g.items.length > 0);
  };

  // Determine the primary "state" pill for the header — the most recent
  // transfer's status is the deal Bronwyn cares about right now.
  const currentTransfer = transfers[0];
  const statusHuman = (raw: string | null | undefined): { label: string; kind: string } => {
    if (!raw) return { label: "No live deal", kind: "none" };
    const s = raw.toLowerCase();
    if (s === "registered") return { label: "Registered", kind: "registered" };
    if (s === "sold_external") return { label: "Sold externally", kind: "muted" };
    if (s === "in_conveyancing") return { label: "In conveyancing", kind: "conveyancing" };
    if (s === "preparing") return { label: "Preparing", kind: "preparing" };
    if (s === "cancelled" || s === "withdrawn" || s === "lapsed")
      return { label: raw.replace(/_/g, " "), kind: "muted" };
    return { label: raw.replace(/_/g, " "), kind: "preparing" };
  };
  const headerStatus = statusHuman(currentTransfer?.status);

  // Since line: surname of the buyer on the most-recent REGISTERED transfer,
  // year of registration, and price paid. Shows "who owns it now, since when,
  // for how much" — the piece of context every SA property document opens with.
  // Null when we have no registered transfer yet (deed hasn't landed / been
  // classified), in which case the hero hides the section entirely rather
  // than filling space with an excuse.
  // Since line: surname of the buyer on the most-recent REGISTERED transfer,
  // year of registration, price paid. Null when no registered transfer yet —
  // the hero hides the section rather than filling space with an excuse.
  // Uses the top-level money() helper (defined at file scope) for price.
  let since: SinceLine = null;
  const lastRegistered = transfers.find(
    (t: any) => (t.status ?? "").toLowerCase() === "registered" && t.registered_date,
  );
  if (lastRegistered) {
    const buyers = tparties.filter(
      (p: any) => p.transfer_id === lastRegistered.id && p.side === "buyer",
    );
    const primary = buyers.find((p: any) => p.is_primary) ?? buyers[0];
    const displayName = primary?.party?.display_name as string | undefined;
    if (displayName) {
      // Take the last word as the surname ("Michael John Wilson" → "Wilson").
      // Entity names ("The Leisure Partnership") keep the full name — safer.
      const parts = displayName.trim().split(/\s+/);
      const surname = parts.length > 1 ? parts[parts.length - 1] : displayName;
      const agr = agreements.find((a: any) => a.transfer_id === lastRegistered.id);
      const priceStr =
        agr?.price != null
          ? `R ${Number(agr.price).toLocaleString("en-ZA")}`
          : null;
      since = {
        surname,
        year: (lastRegistered.registered_date as string).slice(0, 4),
        price: priceStr,
      };
    }
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  const heroPhotos = uniquePhotos.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
  }));
  const heroErven = (erven ?? []).map((e: any) => e.erf_number).join(", ");

  // Muni fallback for hero fields. The property table's own columns take
  // precedence (agent-entered or LLM-extracted values from actual deeds are
  // higher-fidelity than the muni's roll data), but where those are blank the
  // muni fills the gap — that's the whole point of holding the muni mirror.
  // We use the first muni row: for multi-erf properties (169 Links etc.) the
  // headline attributes are effectively the same across erven; the per-erf
  // detail is in the Muni panel below.
  const muniPrimary = muniRecords[0] ?? null;
  const heroTitleDeed = prop.title_deed_no ?? muniPrimary?.title_deed_no ?? null;
  const heroExtent = prop.extent_sqm ?? muniPrimary?.extent_sqm ?? null;
  const heroSuburb = prop.suburb?.name ?? muniPrimary?.suburb ?? null;
  const heroType = prop.property_type?.label ?? muniPrimary?.property_type ?? null;
  const heroMuniValuation = muniPrimary?.muni_valuation ?? null;

  // Split transfers into the active one (most recent) and the historical
  // ones. Active sits in the hero row alongside PropertyHero so the agent
  // sees property + current deal on one screen. Past transfers get their own
  // section below with the tideline year markers.
  const activeTransfer = transfers[0] ?? null;
  const pastTransfers = transfers.slice(1);

  // Reusable transfer card render — used both in the hero row (no timeline
  // marker) and in the ownership history section (with year + dot marker).
  const renderTransferCard = (t: any, opts: { showMarker: boolean }) => {
    const parties = tparties.filter((tp) => tp.transfer_id === t.id);
    const sellers = parties.filter((p) => p.side === "seller");
    const buyers = parties.filter((p) => p.side === "purchaser");
    const agr = agreements.find((a) => a.transfer_id === t.id);
    const ms = milestones.filter((m) => m.transfer_id === t.id);
    const tStatus = statusHuman(t.status);
    const year =
      t.transfer_date?.slice(0, 4) ??
      t.registered_date?.slice(0, 4) ??
      t.created_at?.slice(0, 4) ??
      "—";

    const renderParty = (tp: any) => {
      const p = tp.party;
      if (!p) return null;
      const mem = membersFor(p.id);
      return (
        <div key={p.id} className="party-line">
          <b>{p.entity_name || p.display_name}</b>{" "}
          <span className="pill">{p.party_type}</span>
          {p.registration_no && <span className="muted"> · reg {p.registration_no}</span>}
          {p.id_number && <span className="muted"> · ID {p.id_number}</span>}
          {mem.length > 0 && (
            <ul className="member-list">
              {mem.map((m, i) => (
                <li key={i}>
                  {m.member?.display_name}{" "}
                  <span className="muted">({m.role})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    };

    const card = (
      <div className="transfer-card">
        <div className="transfer-head">
          <b>{t.name}</b>
          <span className={`status-chip status-${tStatus.kind}`}>
            <span className="dot" />
            {tStatus.label}
          </span>
        </div>

        <div className="transfer-actions">
          <MarkSoldButton
            transferId={t.id}
            transferName={t.name}
            propertyId={prop.id}
            currentSoldBy={t.sold_by ?? null}
          />
          {t.sold_by && (
            <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
              Sold by <b>{
                t.sold_by === "dream" ? "Dream Knysna"
                : t.sold_by === "partner" ? "joint-mandate partner"
                : t.sold_by === "other" ? "another agency"
                : "private sale (pre-mandate)"
              }</b>
              {t.sold_by_note ? ` · ${t.sold_by_note}` : ""}
            </p>
          )}
        </div>

        <div className="transfer-cols">
          <div>
            <p className="col-title">Sellers</p>
            {sellers.length ? sellers.map(renderParty) : <p className="muted">—</p>}
          </div>
          <div>
            <p className="col-title">Purchasers</p>
            {buyers.length ? buyers.map(renderParty) : <p className="muted">—</p>}
          </div>
          <div>
            <p className="col-title">Agreement</p>
            {agr ? (
              <>
                <div className="party-line">Price <b>{money(agr.price)}</b></div>
                <div className="party-line">Deposit <b>{money(agr.deposit)}</b></div>
                <div className="party-line">Transfer <b>{agr.transfer_date ?? "—"}</b></div>
              </>
            ) : (
              <p className="muted">—</p>
            )}
          </div>
        </div>

        {ms.length > 0 && (
          <div className="milestones">
            {ms.map((m, i) => (
              <span key={i} className="ms-chip">
                {m.type.replace(/_/g, " ")}
                {m.due_date ? `: ${m.due_date}` : ""} · {m.status}
              </span>
            ))}
          </div>
        )}

        {docsFor(t.id).length > 0 && (
          <div className="doc-list">
            {groupedDocsFor(t.id).map((group) => (
              <div key={group.key} className={`doc-group ${group.key === "fica" ? "is-pii" : ""}`}>
                <p className="doc-group-title">
                  {group.label}
                  <span className="doc-group-count">{group.items.length}</span>
                </p>
                <div className="doc-chips">
                  {/* Split the group's items into image thumbnails vs text
                      chips. Thumbnails hand off to PhotoLightbox so clicking
                      any one opens the overlay with arrow-key nav across
                      the whole group. Text chips keep their existing
                      new-tab-open behaviour. */}
                  {(() => {
                    const chipItems: typeof group.items = [];
                    const thumbItems: { id: string; url: string; title: string }[] = [];
                    for (const d of group.items) {
                      // Detect image by MIME first (reliable), then filename
                      // extension (fallback for octet-stream). Anything
                      // marked PII or in the fica category stays a text
                      // chip regardless.
                      const isImageMime = /^image\//i.test(d.mime_type ?? "");
                      const isImageExt =
                        /\.(jpe?g|png|heic|heif|webp|tif|tiff|gif|bmp)$/i.test(d.title);
                      // Heuristic for Outlook-forwarded images that arrive
                      // as `img-<uuid>` with mime_type=application/octet-stream:
                      // treat any small-ish (<10MB) file named `img-*` with
                      // no known extension as an image. Cheap correction for
                      // a common upstream nuisance.
                      const isOutlookInlineImage =
                        /^img-[0-9a-f]{6,}/i.test(d.title) && !/\.[a-z0-9]+$/i.test(d.title);
                      const showThumb =
                        d.url &&
                        !d.is_pii &&
                        d.category !== "fica" &&
                        (isImageMime || isImageExt || isOutlookInlineImage);
                      if (showThumb) {
                        thumbItems.push({ id: d.id, url: d.url as string, title: d.title });
                      } else {
                        chipItems.push(d);
                      }
                    }
                    return (
                      <>
                        {chipItems.map((d) =>
                          d.url ? (
                            <a
                              key={d.id}
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="doc-chip"
                              title={d.label ?? undefined}
                            >
                              {d.title}
                              {d.is_pii && <span className="pii-dot">PII</span>}
                            </a>
                          ) : (
                            <span
                              key={d.id}
                              className="doc-chip is-missing"
                              title="No file attached — this document row has no stored PDF (correspondence often lands as email body only)."
                            >
                              {d.title}
                              {d.is_pii && <span className="pii-dot">PII</span>}
                            </span>
                          ),
                        )}
                        {thumbItems.length > 0 && <PhotoLightbox photos={thumbItems} />}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && transfers.length > 1 && (
          <MergeTransfer
            loserId={t.id}
            loserName={t.name}
            propertyId={prop.id}
            candidates={transfers
              .filter((c: any) => c.id !== t.id)
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                status: c.status ?? null,
                transferDate: c.transfer_date ?? null,
              }))}
          />
        )}
      </div>
    );

    if (opts.showMarker) {
      return (
        <div key={t.id} className="timeline-row">
          <div className="timeline-marker">
            <span className="timeline-year">{year}</span>
            <span className="timeline-dot" />
          </div>
          {card}
        </div>
      );
    }
    return <div key={t.id}>{card}</div>;
  };

  return (
    <>
    <TopBar />
    <main>
      <header className="app-head record-head">
        <div className="record-head-title">
          <p className="eyebrow">Dream Knysna · Property record</p>
          <h1>{prop.primary_address}</h1>
        </div>
        <div className="record-head-status">
          <span className={`status-chip status-${headerStatus.kind}`}>
            <span className="dot" />
            {headerStatus.label}
          </span>
          {currentTransfer?.transfer_date && (
            <p className="record-head-date">
              Transfer date <b>{currentTransfer.transfer_date}</b>
            </p>
          )}
        </div>
      </header>
      <hr className="tideline" />

      <section className="app-body property-record-body">
        {/* Compact action row — always visible so Fetch from Lightstone stays
            reachable on established records where the Take-on section is
            hidden. Small vertical footprint. */}
        <div className="property-record-actions">
          <LightstoneFetch
            propertyId={prop.id}
            products={LIGHTSTONE_PRODUCTS.map((p) => ({
              code: p.code,
              label: p.label,
              description: p.description,
            }))}
          />
          {isAdmin && (
            <ErfLookup
              propertyId={prop.id}
              propertyAddress={prop.primary_address ?? ""}
            />
          )}
        </div>

        {/* Hero row: PropertyHero (erf polygon + vitals + photos) on the left,
            the active transfer's deal card on the right. Fits property + live
            deal on one laptop screen without scrolling. Past transfers go
            below in the Ownership history section. */}
        <div className="property-record-hero-row">
          <PropertyHero
            lat={(prop as any).lat ?? null}
            lng={(prop as any).lng ?? null}
            prclKey={(prop as any).prcl_key ?? null}
            erven={heroErven}
            titleDeed={heroTitleDeed}
            extentSqm={heroExtent}
            suburb={heroSuburb}
            type={heroType}
            ownership={prop.ownership_type?.label ?? null}
            muniValuation={heroMuniValuation}
            since={since}
            photos={heroPhotos}
            mapboxToken={mapboxToken}
          />
          {activeTransfer ? (
            <div className="property-record-deal">
              {renderTransferCard(activeTransfer, { showMarker: false })}
            </div>
          ) : (
            <div className="property-record-deal property-record-deal--empty">
              <p className="eyebrow">Current deal</p>
              <p>
                No live transfer on this property yet.
                <br />
                Drop a folder in the Take-on section below (or via Triage) to
                bring in the ownership history and start a deal.
              </p>
            </div>
          )}
        </div>

        {/* Sample-data banner — surfaces whenever Lightstone stub results are
            attached to this record so nobody mistakes the SAMPLE placeholder
            for a real Deeds-Office issue. */}
        {docs.some((d) => d.title.startsWith("[SAMPLE]")) && (
          <div
            style={{
              marginTop: 20,
              padding: "12px 16px",
              background: "#fbefd9",
              border: "1px solid #eddfb6",
              borderLeft: "3px solid var(--gold)",
              borderRadius: 10,
              fontSize: 13,
              color: "#7A5814",
            }}
          >
            <b>SAMPLE DATA</b> — Lightstone is not yet connected to Dream OS.
            Documents on this record labelled <code>[SAMPLE]</code> are placeholders from
            the stub adapter and will be replaced by real Lightstone data once the
            live adapter is switched on.
          </div>
        )}

        {/* Take on documents — only shown on properties that have NO transfers
            AND NO documents yet. Established records don't need the drop zone
            hogging vertical space; add-more-docs flows through Triage. Fetch
            from Lightstone is available inline here for fresh take-on flows;
            for established records it's reachable from the action row above. */}
        {transfers.length === 0 && docs.length === 0 && (
          <section style={{ marginTop: 32 }}>
            <div
              className="section-head"
              style={{ marginBottom: 12, alignItems: "flex-end" }}
            >
              <h2 style={{ fontSize: 20, margin: 0 }}>Take on documents</h2>
              <LightstoneFetch
                propertyId={prop.id}
                products={LIGHTSTONE_PRODUCTS.map((p) => ({
                  code: p.code,
                  label: p.label,
                  description: p.description,
                }))}
              />
            </div>
            <DropZone
              propertyId={prop.id}
              overrideLabel={prop.primary_address ?? "Take-on"}
              autoExtract
              variant="compact"
              redirectToBatch
            />
          </section>
        )}

        {muniRecords.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <p className="col-title" style={{ margin: "0 0 12px" }}>
              Municipal record{muniRecords.length > 1 ? "s" : ""}
              <span style={{
                fontSize: 11,
                color: "#7a86a8",
                marginLeft: 10,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                textTransform: "none",
                letterSpacing: "normal",
              }}>
                from Knysna Muni valuation roll
              </span>
            </p>
            {muniRecords.map((m: any) => (
              <div
                key={m.sg_number}
                style={{
                  background: "var(--white)",
                  border: "1px solid var(--mist)",
                  borderRadius: 12,
                  padding: "18px 20px",
                  marginBottom: 10,
                }}
              >
                {/* Header: erf + suburb + full street address + SG code */}
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <p className="eyebrow" style={{ margin: 0 }}>
                      Erf {m.erf_number}
                      {m.suburb ? ` · ${m.suburb}` : ""}
                      {m.town_name && m.town_name !== m.suburb ? ` · ${m.town_name}` : ""}
                    </p>
                    <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600, color: "var(--estuary)" }}>
                      {m.street_no ? `#${m.street_no} · ` : ""}{m.street_name ?? "—"}
                    </p>
                    {m.suburb_hint && m.suburb_hint !== m.suburb && (
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#a4adc4" }}>
                        Muni street hint: {m.suburb_hint}
                      </p>
                    )}
                  </div>
                  <p style={{ margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "#a4adc4" }}>
                    SG: {m.sg_number}
                    {m.muni_erf_code && (
                      <>
                        <br />
                        Muni ID: {m.muni_erf_code}
                      </>
                    )}
                  </p>
                </div>

                {/* Cadastral + rating attributes */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                  {m.muni_valuation != null && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Muni valuation</p>
                      <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 600 }}>{money(m.muni_valuation)}</p>
                    </div>
                  )}
                  {m.extent_sqm != null && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Extent</p>
                      <p style={{ margin: "2px 0 0", fontSize: 15 }}>{Number(m.extent_sqm).toLocaleString("en-ZA")} m²</p>
                    </div>
                  )}
                  {m.area_sqm_valroll != null && m.area_sqm_valroll !== m.extent_sqm && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Valuation roll area</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{Number(m.area_sqm_valroll).toLocaleString("en-ZA")} m²</p>
                    </div>
                  )}
                  {m.zoning && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Zoning</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.zoning}</p>
                    </div>
                  )}
                  {m.tariff && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Tariff</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.tariff}</p>
                    </div>
                  )}
                  {m.ward_no && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Ward</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.ward_no}</p>
                    </div>
                  )}
                  {m.property_type && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Type</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.property_type}</p>
                    </div>
                  )}
                  {m.usage_ && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Declared use</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.usage_}</p>
                    </div>
                  )}
                  {m.sectional_title_flag && !m.sect_scheme_name && (
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>Sectional title</p>
                      <p style={{ margin: "2px 0 0", fontSize: 14 }}>{m.sectional_title_flag}</p>
                    </div>
                  )}
                </div>

                {m.prop_description && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#5b6885" }}>
                    <span className="eyebrow" style={{ marginRight: 8 }}>Description</span>
                    {m.prop_description}
                  </div>
                )}

                {/* Deed + purchase history */}
                {(m.title_deed_no || m.old_title_deed_no || m.deeds_office || m.registration_date || m.purch_date || m.purch_price) && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--mist)" }}>
                    <p className="eyebrow" style={{ margin: "0 0 6px" }}>Deed & purchase</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 13, color: "#5b6885" }}>
                      {m.title_deed_no && <div><b>{m.title_deed_no}</b> · current deed</div>}
                      {m.old_title_deed_no && <div style={{ color: "#7a86a8" }}>{m.old_title_deed_no} · previous deed</div>}
                      {m.deeds_office && <div>{m.deeds_office} deeds office</div>}
                      {m.registration_date && <div>Registered {m.registration_date}</div>}
                      {m.purch_price != null && <div>{money(m.purch_price)} · purchase</div>}
                      {m.purch_date && <div>{m.purch_date} · purchase date</div>}
                    </div>
                  </div>
                )}

                {/* Bond */}
                {(m.bond_number || m.bond_amount != null || m.bond_institution) && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--mist)" }}>
                    <p className="eyebrow" style={{ margin: "0 0 6px" }}>Existing bond</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 13, color: "#5b6885" }}>
                      {m.bond_institution && <div><b>{m.bond_institution}</b></div>}
                      {m.bond_amount != null && <div>{money(m.bond_amount)} · bond amount</div>}
                      {m.bond_number && <div style={{ color: "#a4adc4" }}>Bond {m.bond_number}</div>}
                    </div>
                  </div>
                )}

                {/* Sectional scheme */}
                {(m.sect_scheme_name || m.sect_scheme_unit != null) && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--mist)" }}>
                    <p className="eyebrow" style={{ margin: "0 0 6px" }}>Sectional scheme</p>
                    <div style={{ fontSize: 13, color: "#5b6885" }}>
                      {m.sect_scheme_name}
                      {m.sect_scheme_unit != null ? ` · unit ${m.sect_scheme_unit}` : ""}
                    </div>
                  </div>
                )}

                <p style={{ margin: "12px 0 0", fontSize: 10, color: "#a4adc4", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                  Muni data refreshed {m.refreshed_at ? new Date(m.refreshed_at).toISOString().slice(0, 10) : "—"}
                </p>
              </div>
            ))}
          </section>
        )}

        {uniquePhotos.length > 0 && (
          <section className="photo-strip">
            <p className="col-title" style={{ margin: "24px 0 10px" }}>
              Photos ({uniquePhotos.length})
            </p>
            <div className="photo-strip-scroll">
              {uniquePhotos.slice(0, 24).map((p) => (
                <a
                  key={p.id}
                  href={p.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="photo-tile"
                  title={p.title}
                  style={{ backgroundImage: p.url ? `url(${p.url})` : undefined }}
                >
                  {!p.url && <span className="photo-tile-fallback">📷</span>}
                </a>
              ))}
              {uniquePhotos.length > 24 && (
                <div className="photo-tile more">
                  <span>+{uniquePhotos.length - 24} more</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Ownership history: only past transfers. The active transfer lives
            in the hero row above. Hidden entirely when there's just one (or
            zero) transfers on record — no empty section noise. */}
        {pastTransfers.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: 36, marginBottom: 4 }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>Ownership history</h2>
              <span className="mono" style={{ fontSize: 11, color: "#8090b5", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {pastTransfers.length} prior {pastTransfers.length === 1 ? "transfer" : "transfers"}
              </span>
            </div>
            <div className="timeline">
              {pastTransfers.map((t) => renderTransferCard(t, { showMarker: true }))}
            </div>
          </>
        )}
      </section>
    </main>
    </>
  );
}
