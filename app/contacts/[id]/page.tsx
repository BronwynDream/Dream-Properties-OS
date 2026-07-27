import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MaskedId from "../MaskedId";

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

  // Role timeline: every transfer_party for this party, with the transfer
  // + its property + the agreement price. Ordered newest first.
  const { data: rolesData } = await supabase
    .from("transfer_party")
    .select(
      "side, is_primary, transfer:transfer_id(id, name, status, transfer_date, registered_date, property:property_id(id, primary_address), agreement(price))",
    )
    .eq("party_id", params.id);
  const roles = ((rolesData ?? []) as any[]).sort((a, b) => {
    const ay = a.transfer?.registered_date ?? a.transfer?.transfer_date ?? "";
    const by = b.transfer?.registered_date ?? b.transfer?.transfer_date ?? "";
    return by.localeCompare(ay); // newest first
  });

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
