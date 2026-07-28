import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MaskedId from "../MaskedId";
import { getSetting } from "@/lib/settings";
import { deriveFicaState, ficaLabel, type RawFicaRecord } from "@/lib/fica";
import { FicaStatusBadge, PropertyDate } from "@/app/components/format";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function money(v: any): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `R ${n.toLocaleString("en-ZA")}` : "—";
}

export default async function ContactDetail({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: party } = await supabase
    .from("party")
    .select(
      "id, party_type, display_name, first_names, surname, entity_name, registration_no, id_number, passport_no, email, phone, whatsapp, postal_address, physical_address, matrimonial_regime, notes",
    )
    .eq("id", params.id)
    .single();
  if (!party) notFound();

  // Role timeline + FICA records — same round-trip so the page renders
  // in one shot. FICA is joined to transfer so each row can name the
  // deal it was verified for.
  const validityDays = await getSetting("fica.verification_valid_days");
  const [{ data: rolesData }, { data: ficaData }] = await Promise.all([
    supabase
      .from("transfer_party")
      .select(
        "side, is_primary, transfer:transfer_id(id, name, status, transfer_date, registered_date, property:property_id(id, primary_address), agreement(price))",
      )
      .eq("party_id", params.id),
    supabase
      .from("fica")
      .select(
        "id, transfer_id, role, status, risk, source_of_funds, verified_at, updated_at, notes, transfer:transfer_id(id, name, property:property_id(id, primary_address))",
      )
      .eq("party_id", params.id)
      .order("updated_at", { ascending: false }),
  ]);
  const roles = ((rolesData ?? []) as any[]).sort((a, b) => {
    const ay = a.transfer?.registered_date ?? a.transfer?.transfer_date ?? "";
    const by = b.transfer?.registered_date ?? b.transfer?.transfer_date ?? "";
    return by.localeCompare(ay); // newest first
  });
  const ficaRows = (ficaData ?? []) as any[];
  const derivedFica = deriveFicaState(
    ficaRows.map((f) => ({
      status: f.status,
      verified_at: f.verified_at,
      updated_at: f.updated_at,
      transfer_id: f.transfer_id,
      role: f.role,
    })) as RawFicaRecord[],
    validityDays,
  );

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head record-head">
          <div className="record-head-title">
            <p className="eyebrow">Dream Knysna · Contact</p>
            <h1>{party.display_name}</h1>
          </div>
          <div className="record-head-status">
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.72)",
              }}
            >
              {party.party_type.replace("_", " ")}
            </span>
          </div>
        </header>
        <hr className="tideline" />

        <section className="app-body property-record-body">
          <FicaPanel derived={derivedFica} records={ficaRows} validityDays={validityDays} />
          <div className="contact-detail">
            {/* Left: identity + contact info */}
            <div className="contact-info">
              <p className="col-title">Identity</p>
              <dl className="contact-dl">
                {party.entity_name && (
                  <>
                    <dt>Entity name</dt>
                    <dd>{party.entity_name}</dd>
                  </>
                )}
                {party.registration_no && (
                  <>
                    <dt>Registration</dt>
                    <dd className="mono">{party.registration_no}</dd>
                  </>
                )}
                {party.id_number && (
                  <>
                    <dt>SA ID</dt>
                    <dd><MaskedId value={party.id_number} /></dd>
                  </>
                )}
                {party.passport_no && (
                  <>
                    <dt>Passport</dt>
                    <dd className="mono">{party.passport_no}</dd>
                  </>
                )}
                {party.matrimonial_regime && party.matrimonial_regime !== "unknown" && (
                  <>
                    <dt>Marital</dt>
                    <dd>{party.matrimonial_regime.replace(/_/g, " ")}</dd>
                  </>
                )}
              </dl>

              <p className="col-title" style={{ marginTop: 24 }}>Channels</p>
              <dl className="contact-dl">
                {party.email && (
                  <>
                    <dt>Email</dt>
                    <dd><a href={`mailto:${party.email}`}>{party.email}</a></dd>
                  </>
                )}
                {party.phone && (
                  <>
                    <dt>Phone</dt>
                    <dd className="mono">{party.phone}</dd>
                  </>
                )}
                {party.whatsapp && (
                  <>
                    <dt>WhatsApp</dt>
                    <dd className="mono">{party.whatsapp}</dd>
                  </>
                )}
              </dl>

              {(party.postal_address || party.physical_address) && (
                <>
                  <p className="col-title" style={{ marginTop: 24 }}>Address</p>
                  <dl className="contact-dl">
                    {party.postal_address && (
                      <>
                        <dt>Postal</dt>
                        <dd>{party.postal_address}</dd>
                      </>
                    )}
                    {party.physical_address && (
                      <>
                        <dt>Physical</dt>
                        <dd>{party.physical_address}</dd>
                      </>
                    )}
                  </dl>
                </>
              )}
            </div>

            {/* Right: role timeline */}
            <div className="role-timeline">
              <p className="col-title">Role timeline · {roles.length} {roles.length === 1 ? "transfer" : "transfers"}</p>
              {roles.length === 0 ? (
                <p style={{ color: "var(--paper-mute)", fontStyle: "italic", marginTop: 12 }}>
                  No transfer records for this party yet.
                </p>
              ) : (
                <table className="role-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Side</th>
                      <th>Property</th>
                      <th>Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r: any) => {
                      const t = r.transfer;
                      const year = (t?.registered_date ?? t?.transfer_date ?? "").slice(0, 4) || "—";
                      const price = Array.isArray(t?.agreement) ? t.agreement[0]?.price : t?.agreement?.price;
                      const sideLabel = r.side === "purchaser" ? "Buyer" : r.side === "seller" ? "Seller" : "Other";
                      return (
                        <tr key={t?.id ?? Math.random()}>
                          <td className="mono">{year}</td>
                          <td>{sideLabel}{r.is_primary && " ★"}</td>
                          <td>
                            {t?.property?.id ? (
                              <Link href={`/properties/${t.property.id}`}>{t.property.primary_address}</Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>{money(price)}</td>
                          <td style={{ color: "var(--paper-mute)", fontSize: 12 }}>{t?.status ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {party.notes && (
                <>
                  <p className="col-title" style={{ marginTop: 24 }}>Notes</p>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{party.notes}</p>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

// FICA panel — sits above the identity + timeline split. The badge is the
// hero (one glance = do I trust this contact for a deal). The record table
// below is the audit trail: which transfer, which role, when, by whom.
//
// Kept as an inline component so all the FICA-shape knowledge (record
// schema, role labels, risk display) lives with the page that renders it
// — no premature abstraction. If a second page needs the same panel, lift
// it into app/components/fica/ then.
function FicaPanel({
  derived,
  records,
  validityDays,
}: {
  derived: import("@/lib/fica").DerivedFica;
  records: any[];
  validityDays: number;
}) {
  const label = ficaLabel(derived);
  return (
    <section
      style={{
        border: "1px solid var(--line-soft, #E7E0D2)",
        background: "var(--paper-1, #F5F1E8)",
        borderRadius: "var(--radius-md, 8px)",
        padding: "16px 20px",
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-500, #6B6153)",
            }}
          >
            FICA · POPIA
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "'Fraunces', serif",
              fontSize: 18,
              color: "var(--estuary, #132B84)",
              fontWeight: 500,
            }}
          >
            {label}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--paper-mute, #6a7692)" }}>
            {records.length === 0
              ? "No FIC Act records on file for this party."
              : `${records.length} FIC record${records.length === 1 ? "" : "s"} · validity window ${validityDays} days`}
          </p>
        </div>
        <FicaStatusBadge derived={derived} size="md" />
      </div>

      {records.length > 0 && (
        <table
          className="role-table"
          style={{ marginTop: 16, width: "100%" }}
        >
          <thead>
            <tr>
              <th>Deal</th>
              <th>Role</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {records.map((f: any) => (
              <tr key={f.id}>
                <td>
                  {f.transfer?.id ? (
                    <Link href={`/properties/${f.transfer?.property?.id ?? ""}`}>
                      {f.transfer?.property?.primary_address ?? f.transfer?.name ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ fontSize: 12, textTransform: "capitalize" }}>
                  {String(f.role ?? "").replace(/_/g, " ")}
                </td>
                <td>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 3,
                      background: statusBg(f.status),
                      color: statusFg(f.status),
                    }}
                  >
                    {f.status}
                  </span>
                </td>
                <td style={{ fontSize: 12, textTransform: "capitalize", color: riskColor(f.risk) }}>
                  {f.risk}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {f.verified_at ? (
                    <PropertyDate value={f.verified_at.slice(0, 10)} />
                  ) : (
                    <span style={{ color: "var(--paper-mute, #6a7692)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function statusBg(s: string): string {
  if (s === "verified") return "var(--status-active-bg)";
  if (s === "expired") return "var(--status-withdrawn-bg)";
  return "var(--status-under-offer-bg)"; // outstanding / received
}
function statusFg(s: string): string {
  if (s === "verified") return "var(--status-active-fg)";
  if (s === "expired") return "var(--status-withdrawn-fg)";
  return "var(--status-under-offer-fg)";
}
function riskColor(r: string): string {
  if (r === "high") return "var(--critical, #9A3B34)";
  if (r === "medium") return "var(--caution, #A9772F)";
  return "var(--ink-500, #6B6153)";
}
