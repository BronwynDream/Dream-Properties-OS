import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MergeTransfer from "./MergeTransfer";
import MarkSoldButton from "./MarkSoldButton";
import DropZone from "@/app/triage/DropZone";
import LightstoneFetch from "./LightstoneFetch";
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
    .select("erf_number, portion")
    .eq("property_id", params.id);

  // Try the post-0033 schema first (sold_by, sold_by_note). If those columns
  // don't yet exist in this environment (migration not applied), fall back to
  // the legacy select — otherwise the page silently renders as if the property
  // had no transfers at all, which looks like data loss but isn't.
  let { data: transfersData, error: transfersErr } = await supabase
    .from("transfer")
    .select("id, name, status, transfer_date, registered_date, created_at, sold_by, sold_by_note")
    .eq("property_id", params.id)
    .order("created_at", { ascending: false });
  if (transfersErr) {
    // eslint-disable-next-line no-console
    console.warn(
      `[property] transfer select failed, retrying without 0033 columns: ${transfersErr.message}`,
    );
    const legacy = await supabase
      .from("transfer")
      .select("id, name, status, transfer_date, registered_date, created_at")
      .eq("property_id", params.id)
      .order("created_at", { ascending: false });
    transfersData = legacy.data;
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
    // Photos strip is strict: only files classified as a photo doc_type. Scanned
    // ID cards and passports are image files too but are id_document / passport
    // by doc_type — surfacing them in a public-looking photo strip would be a
    // POPIA hygiene problem.
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

  const facts = [
    { label: "Erf", value: (erven ?? []).map((e: any) => e.erf_number).join(", "), mono: true },
    { label: "Title deed", value: prop.title_deed_no, mono: true },
    { label: "Extent", value: prop.extent_sqm ? `${prop.extent_sqm} m²` : null },
    { label: "Suburb", value: prop.suburb?.name },
    { label: "Type", value: prop.property_type?.label },
    { label: "Ownership", value: prop.ownership_type?.label },
  ];

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

      <section className="app-body" style={{ maxWidth: 1000 }}>
        {/* Cadastral strip — reads left-to-right like a Deeds Office cover sheet.
            Missing values dim so what's known vs unknown is visually obvious. */}
        <div className="cadastral">
          {facts.map((f) => (
            <div key={f.label} className={`cadastral-item ${!f.value ? "is-empty" : ""}`}>
              <span className="cadastral-label">{f.label}</span>
              <span className={`cadastral-value ${f.mono ? "mono" : ""}`}>
                {f.value ?? "—"}
              </span>
            </div>
          ))}
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

        {/* Take on documents — collapsed by default so it doesn't dominate the
            record for established properties. The Fetch from Lightstone button
            stays visible in the header (it's a distinct action, not part of
            the drop flow). Click the summary to expand the drop zone when a
            new batch needs to land. */}
        <section style={{ marginTop: 32 }}>
          <div
            className="section-head"
            style={{ marginBottom: 12, alignItems: "flex-end" }}
          >
            <h2 style={{ fontSize: 20, margin: 0 }}>Take on documents</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <LightstoneFetch
                propertyId={prop.id}
                products={LIGHTSTONE_PRODUCTS.map((p) => ({
                  code: p.code,
                  label: p.label,
                  description: p.description,
                }))}
              />
            </div>
          </div>
          <details className="dropzone-collapse">
            <summary>
              <span>Drop a property folder to add documents</span>
              <span className="dropzone-collapse-caret" aria-hidden="true">+</span>
            </summary>
            <div style={{ marginTop: 10 }}>
              <DropZone
                propertyId={prop.id}
                overrideLabel={prop.primary_address ?? "Take-on"}
                autoExtract
                variant="compact"
                redirectToBatch
              />
            </div>
          </details>
        </section>

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

        <div className="section-head" style={{ marginTop: 36, marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Ownership timeline</h2>
          <span className="mono" style={{ fontSize: 11, color: "#8090b5", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {transfers.length} {transfers.length === 1 ? "transfer" : "transfers"}
          </span>
        </div>
        {transfers.length === 0 && (
          <p style={{ color: "#5b6885", marginTop: 12 }}>
            No transfers on record yet. Drop this property&apos;s folder in Triage to bring in
            its ownership history.
          </p>
        )}

        <div className="timeline">
        {transfers.map((t) => {
          const parties = tparties.filter((tp) => tp.transfer_id === t.id);
          const sellers = parties.filter((p) => p.side === "seller");
          const buyers = parties.filter((p) => p.side === "purchaser");
          const agr = agreements.find((a) => a.transfer_id === t.id);
          const ms = milestones.filter((m) => m.transfer_id === t.id);

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

          const tStatus = statusHuman(t.status);
          const year =
            t.transfer_date?.slice(0, 4) ??
            t.registered_date?.slice(0, 4) ??
            t.created_at?.slice(0, 4) ??
            "—";

          return (
            <div key={t.id} className="timeline-row">
              <div className="timeline-marker">
                <span className="timeline-year">{year}</span>
                <span className="timeline-dot" />
              </div>
              <div className="transfer-card">
              <div className="transfer-head">
                <b>{t.name}</b>
                <span className={`status-chip status-${tStatus.kind}`}>
                  <span className="dot" />
                  {tStatus.label}
                </span>
              </div>

              {/* Mark-as-sold sits immediately below the head — discoverable
                  without scrolling past docs. Any agent, any transfer. */}
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
                        {group.items.map((d) => (
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
                          )
                        ))}
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
            </div>
          );
        })}
        </div>
      </section>
    </main>
    </>
  );
}
