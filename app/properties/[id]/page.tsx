import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

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

  const { data: transfersData } = await supabase
    .from("transfer")
    .select("id, name, status, transfer_date, registered_date, created_at")
    .eq("property_id", params.id)
    .order("created_at", { ascending: false });
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

    const { data: signed } = await supabase.storage
      .from(d.storage_bucket)
      .createSignedUrl(d.storage_path, 3600);
    const isImage =
      (d.mime_type ?? "").startsWith("image/") ||
      /\.(jpe?g|png|heic|heif|webp|gif|tiff?)$/i.test(d.title ?? "") ||
      d.doc_type?.code === "photo";
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

  return (
    <>
    <TopBar />
    <main>
      <header
        className="app-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <p className="eyebrow">Dream Knysna · Property record</p>
          <h1>{prop.primary_address}</h1>
        </div>
        <Link href="/properties" className="ghost-link">
          ← Properties
        </Link>
      </header>
      <hr className="tideline" />

      <section className="app-body" style={{ maxWidth: 1000 }}>
        {/* Property facts */}
        <div className="fact-grid">
          <div><span>Suburb</span><b>{prop.suburb?.name ?? "—"}</b></div>
          <div><span>Erven</span><b>{(erven ?? []).map((e: any) => e.erf_number).join(", ") || "—"}</b></div>
          <div><span>Title deed</span><b className="mono">{prop.title_deed_no ?? "—"}</b></div>
          <div><span>Extent</span><b>{prop.extent_sqm ? `${prop.extent_sqm} m²` : "—"}</b></div>
          <div><span>Type</span><b>{prop.property_type?.label ?? "—"}</b></div>
          <div><span>Ownership</span><b>{prop.ownership_type?.label ?? "—"}</b></div>
        </div>

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

        <h2 style={{ marginTop: 36, fontSize: 20 }}>
          Transfers ({transfers.length})
        </h2>
        {transfers.length === 0 && (
          <p style={{ color: "#5b6885" }}>No transfers recorded on this property yet.</p>
        )}

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

          return (
            <div key={t.id} className="transfer-card">
              <div className="transfer-head">
                <b>{t.name}</b>
                <span className={`tier tier-${t.status === "registered" ? "green" : "amber"}`}>
                  {t.status}
                </span>
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
                  <p className="col-title">Documents ({docsFor(t.id).length})</p>
                  {groupedDocsFor(t.id).map((group) => (
                    <div key={group.key} className="doc-group">
                      <p className="doc-group-title">
                        {group.label} <span className="doc-group-count">{group.items.length}</span>
                      </p>
                      <div className="doc-chips">
                        {group.items.map((d) => (
                          <a
                            key={d.id}
                            href={d.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="doc-chip"
                            title={d.label ?? undefined}
                          >
                            {d.title}
                            {d.is_pii && <span className="pii-dot">PII</span>}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
    </>
  );
}
