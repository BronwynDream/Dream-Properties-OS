// Party-level FICA state derivation.
//
// FICA in the DB is per (transfer, party, role) — that's correct legally
// (the FIC Act requires KYC per business relationship, not per contact).
// But for a contact record or a compliance dashboard we want a single
// "where does this party stand right now" summary across all their FICA
// records. That's what deriveFicaState does.
//
// State semantics:
//   verified — most recent record is 'verified' AND verified_at is within
//              the configured validity window (default 730 days ≈ 2y).
//              Fresh KYC; can be re-used for a new deal.
//   stale    — most recent record is 'verified' but verified_at is older
//              than the validity window. Re-verify before the next deal.
//   pending  — most recent record is 'outstanding' or 'received' (docs
//              in, verification not yet completed). Chase the agent.
//   expired  — most recent record is 'expired' (explicit lapse). Red flag.
//   none     — no FICA record on file for this party at all.

export type RawFicaRecord = {
  status: "outstanding" | "received" | "verified" | "expired";
  verified_at: string | null;
  updated_at: string | null;
  transfer_id: string;
  role: string;
};

export type FicaState = "verified" | "stale" | "pending" | "expired" | "none";

export type DerivedFica = {
  state: FicaState;
  latestAt: string | null; // ISO of verified_at (if verified) else updated_at
  ageDays: number | null;  // days since latestAt, null if none
  count: number;           // total records for the party
};

// Pick the most recent record by (verified_at, else updated_at). Records with
// no timestamp at all sink to the bottom.
function pickLatest(records: RawFicaRecord[]): RawFicaRecord | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => {
    const ta = a.verified_at ?? a.updated_at ?? "";
    const tb = b.verified_at ?? b.updated_at ?? "";
    return tb.localeCompare(ta);
  })[0];
}

export function deriveFicaState(
  records: RawFicaRecord[],
  validityDays: number,
): DerivedFica {
  if (records.length === 0) {
    return { state: "none", latestAt: null, ageDays: null, count: 0 };
  }
  const latest = pickLatest(records);
  if (!latest) {
    return { state: "none", latestAt: null, ageDays: null, count: records.length };
  }
  const ref = latest.verified_at ?? latest.updated_at;
  const ageDays = ref ? Math.max(0, Math.round((Date.now() - Date.parse(ref)) / 86_400_000)) : null;

  let state: FicaState;
  if (latest.status === "expired") state = "expired";
  else if (latest.status === "verified") {
    state = ageDays !== null && ageDays > validityDays ? "stale" : "verified";
  } else {
    // outstanding or received
    state = "pending";
  }
  return { state, latestAt: ref, ageDays, count: records.length };
}

// Human label for a derived state — used by badge + tooltips. Kept as a
// pure function so both server-render and client-render paths share it.
export function ficaLabel(d: DerivedFica): string {
  switch (d.state) {
    case "verified":
      return d.ageDays !== null ? `Verified · ${d.ageDays}d ago` : "Verified";
    case "stale":
      return d.ageDays !== null ? `Verified ${d.ageDays}d ago — re-verify` : "Verified — re-verify";
    case "pending":
      return "Docs in — not verified";
    case "expired":
      return "Expired";
    case "none":
      return "No FICA on file";
  }
}
