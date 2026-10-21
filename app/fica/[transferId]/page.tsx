import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar from "@/app/components/TopBar";
import { createServiceClient } from "@/lib/supabase/service";
import { getSetting } from "@/lib/settings";
import { deskUser, loadDeals, STATUS_LABEL, UPLOAD_CATEGORIES, type DeskDoc } from "@/lib/ficaDesk";
import PartyCard from "../PartyCard";
import AssignDoc from "../AssignDoc";
import UploadDoc from "../UploadDoc";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rand = (n: number | null) => (n == null ? null : "R " + Math.round(n).toLocaleString("en-ZA").replace(/[, ]/g, " "));
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : "");

export default async function FicaDeal({ params }: { params: { transferId: string } }) {
  const me = await deskUser();
  if (!me) notFound();
  if (!UUID.test(params.transferId)) notFound();
  const svc = createServiceClient();
  const validityDays = await getSetting("fica.verification_valid_days");
  const [deal] = await loadDeals(svc, { transferId: params.transferId, validityDays });
  if (!deal) notFound();
  const { data: types } = await svc.from("document_type").select("id, code, label, category").in("category", [...UPLOAD_CATEGORIES]).eq("active", true).order("category").order("label");
  const docTypes = (types ?? []) as { id: string; code: string; label: string; category: string }[];
  const partyOptions = deal.parties.map((p) => ({ id: `${p.id}|${p.side}`, label: `${p.side === "seller" ? "Seller" : "Buyer"}: ${p.name}` }));

  return (
    <>
      <TopBar />
      <main className="fica-wrap">
        <p className="fica-back"><Link href="/fica">← FICA desk</Link></p>
        <header className="fica-head">
          <p className="eyebrow">{STATUS_LABEL[deal.status] ?? deal.status}{deal.agentName ? ` · ${deal.agentName}` : ""}</p>
          <h1>{deal.address}</h1>
          <p className="fica-sub">
            {[deal.erven.length ? `Erf ${deal.erven.join(", ")}` : null, deal.suburb, deal.askingPrice ? `Asking ${rand(deal.askingPrice)}` : null].filter(Boolean).join(" · ")}
          </p>
        </header>

        {deal.parties.length === 0 && (
          <p className="fica-callout">No sellers or buyers are recorded on this deal yet. Ask {deal.agentName ?? "the agent"} to add them.</p>
        )}

        <div className="fica-parties">
          {deal.parties.map((p) => (
            <PartyCard key={p.id + p.side} transferId={deal.transferId} party={p} docTypes={docTypes} />
          ))}
        </div>

        {deal.unassigned.length > 0 && (
          <section className="fica-section">
            <h2>Waiting to be assigned</h2>
            <p className="fica-sub">FICA papers filed on this deal without a person. Say whose they are.</p>
            <ul className="fica-docs" role="list">
              {deal.unassigned.map((d) => (
                <li key={d.id}>
                  <DocLink d={d} />
                  <AssignDoc transferId={deal.transferId} documentId={d.id} options={partyOptions} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="fica-section">
          <h2>Agreement of sale</h2>
          {deal.agreements.length ? (
            <ul className="fica-docs" role="list">
              {deal.agreements.map((d) => (
                <li key={d.id}>
                  <a href={`/api/fica/doc/${d.id}`} target="_blank" rel="noopener">{d.label ?? "Agreement of sale"}: page 2 (the parties)</a>
                  <span className="fica-when">{day(d.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fica-sub">No signed agreement on file.</p>
          )}
        </section>

        <section className="fica-section">
          <h2>Certificates</h2>
          {deal.certGaps.length > 0 && (
            <ul className="fica-gaps" role="list">
              {deal.certGaps.map((g) => <li key={g}>{g}</li>)}
            </ul>
          )}
          {deal.certDocs.length ? (
            <ul className="fica-docs" role="list">
              {deal.certDocs.map((d) => (
                <li key={d.id}><DocLink d={d} /></li>
              ))}
            </ul>
          ) : (
            !deal.certGaps.length && <p className="fica-sub">No certificates on file.</p>
          )}
          <UploadDoc transferId={deal.transferId} partyId={null} side={null} docTypes={docTypes.filter((t) => t.category === "compliance")} label="Upload a certificate" />
        </section>
      </main>
    </>
  );
}

function DocLink({ d }: { d: DeskDoc }) {
  return (
    <>
      <a href={`/api/fica/doc/${d.id}`} target="_blank" rel="noopener">{d.label && d.label !== d.title ? `${d.label}: ${d.title}` : d.title}</a>
      <span className="fica-when">{day(d.uploadedAt)}</span>
    </>
  );
}
