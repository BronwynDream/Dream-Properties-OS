import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import SearchInput from "./SearchInput";
import ContactRow from "./ContactRow";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Search = { q?: string };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const q = (searchParams.q ?? "").trim();

  // Only query when there's a search term. Avoids listing the whole party
  // table (could be hundreds of rows) on first landing.
  let parties: any[] = [];
  if (q.length >= 2) {
    // Multi-field OR. ilike is fine at Dream's scale (~hundreds of parties);
    // the gin_trgm indexes from migration 0046 support fuzzy matching.
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const { data } = await supabase
      .from("party")
      .select(
        "id, party_type, display_name, entity_name, id_number, email, phone, whatsapp",
      )
      .or(
        `display_name.ilike.${like},entity_name.ilike.${like},email.ilike.${like},phone.ilike.${like},id_number.ilike.${like}`,
      )
      .order("display_name", { ascending: true })
      .limit(100);
    parties = data ?? [];
  }

  // Fetch role summaries for the returned party ids in a single round-trip.
  const partyIds = parties.map((p) => p.id);
  const summaries = new Map<string, { side: string; year: string | null }[]>();
  if (partyIds.length > 0) {
    const { data: tps } = await supabase
      .from("transfer_party")
      .select("party_id, side, transfer:transfer_id(transfer_date, registered_date)")
      .in("party_id", partyIds);
    for (const tp of (tps ?? []) as any[]) {
      const dateStr =
        tp.transfer?.registered_date ??
        tp.transfer?.transfer_date ??
        null;
      const year = dateStr ? String(dateStr).slice(0, 4) : null;
      const arr = summaries.get(tp.party_id) ?? [];
      arr.push({ side: tp.side, year });
      summaries.set(tp.party_id, arr);
    }
  }

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Contacts</p>
          <h1>
            {q ? `${parties.length} match${parties.length === 1 ? "" : "es"} for "${q}"` : "Contact search"}
          </h1>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <div style={{ marginBottom: 24 }}>
            <SearchInput />
          </div>

          {q.length < 2 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "24px 0" }}>
              Type at least 2 characters to search. Try a surname, an ID number,
              an email, a company name, or a phone number.
            </p>
          ) : parties.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "24px 0" }}>
              No parties matched. Check spelling, or try a different field
              (e.g. just the surname without initials).
            </p>
          ) : (
            <div className="contacts-list">
              {parties.map((p) => (
                <ContactRow
                  key={p.id}
                  id={p.id}
                  partyType={p.party_type}
                  displayName={p.display_name}
                  entityName={p.entity_name}
                  idNumber={p.id_number}
                  email={p.email}
                  phone={p.phone}
                  roles={summaries.get(p.id) ?? []}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
