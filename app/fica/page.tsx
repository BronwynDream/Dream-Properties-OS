import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar from "@/app/components/TopBar";
import { createServiceClient } from "@/lib/supabase/service";
import { getSetting } from "@/lib/settings";
import { deskUser, loadDeals, STATUS_LABEL, type DeskDeal } from "@/lib/ficaDesk";

// FICA desk (2026-10-21) — every deal, its sellers and buyers, and what's
// missing. The compliance user's whole Dream OS; directors can open it too.

export const dynamic = "force-dynamic";

const rand = (n: number | null) => (n == null ? null : "R " + Math.round(n).toLocaleString("en-ZA").replace(/[, ]/g, " "));

export default async function FicaDesk({ searchParams }: { searchParams: { show?: string; q?: string } }) {
  const me = await deskUser();
  if (!me) notFound();
  const svc = createServiceClient();
  const validityDays = await getSetting("fica.verification_valid_days");
  const all = searchParams.show === "all";
  const q = (searchParams.q ?? "").trim().toLowerCase();
  let deals = await loadDeals(svc, { includeClosed: all, validityDays });
  if (q) {
    deals = deals.filter((d) =>
      [d.address, d.suburb ?? "", ...d.erven, ...d.parties.map((p) => p.name)].some((s) => s.toLowerCase().includes(q)),
    );
  }
  const withGaps = deals.filter((d) => d.gapCount > 0).sort((a, b) => b.gapCount - a.gapCount);
  const clear = deals.filter((d) => d.gapCount === 0);
  const peopleMissing = deals.reduce((a, d) => a + d.parties.filter((p) => p.gaps.length).length, 0);
  const unassigned = deals.reduce((a, d) => a + d.unassigned.length, 0);

  return (
    <>
      <TopBar />
      <main className="fica-wrap">
        <header className="fica-head">
          <p className="eyebrow">FICA desk</p>
          <h1>{withGaps.length ? `${withGaps.length} deal${withGaps.length === 1 ? "" : "s"} with gaps` : "No gaps"}</h1>
          <p className="fica-sub">
            {peopleMissing} {peopleMissing === 1 ? "person" : "people"} with something missing
            {unassigned ? ` · ${unassigned} document${unassigned === 1 ? "" : "s"} waiting to be assigned` : ""}
            {` · ${deals.length} ${all ? "deals" : "live deals"}`}
          </p>
        </header>

        <form className="fica-tools" action="/fica">
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search address, erf or name" aria-label="Search" />
          {all && <input type="hidden" name="show" value="all" />}
          <button className="btn-secondary" type="submit">Search</button>
          <nav className="reports-tabs" aria-label="Show">
            <Link href={`/fica${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={!all ? "on" : ""}>Live deals</Link>
            <Link href={`/fica?show=all${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={all ? "on" : ""}>All deals</Link>
          </nav>
        </form>

        {deals.length === 0 ? (
          <p className="reports-empty">No deals match.</p>
        ) : (
          <ul className="fica-list" role="list">
            {[...withGaps, ...clear].map((d) => (
              <DealRow key={d.transferId} d={d} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function DealRow({ d }: { d: DeskDeal }) {
  return (
    <li>
      <Link href={`/fica/${d.transferId}`} className={`fica-row${d.gapCount ? "" : " clear"}`}>
        <div className="fica-row-main">
          <span className="fica-addr">{d.address}</span>
          <span className="fica-meta">
            {[d.erven.length ? `Erf ${d.erven.join(", ")}` : null, d.suburb, STATUS_LABEL[d.status] ?? d.status, d.agentName, rand(d.askingPrice)].filter(Boolean).join(" · ")}
          </span>
          <span className="fica-people">
            {d.parties.length === 0
              ? "No sellers or buyers recorded"
              : d.parties.map((p) => (
                  <span key={p.id + p.side} className={p.gaps.length ? "warn" : "ok"}>
                    {p.side === "seller" ? "Seller" : "Buyer"}: {p.name}
                    {p.gaps.length ? ` (${p.gaps.length})` : " ✓"}
                  </span>
                ))}
          </span>
        </div>
        <span className={`fica-count${d.gapCount ? "" : " ok"}`}>{d.gapCount ? `${d.gapCount} missing` : "Complete"}</span>
      </Link>
    </li>
  );
}
