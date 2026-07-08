// Shared role vocabulary for the Team & Access screen.
// Access is enforced by RLS (0005_rls.sql). These labels + descriptions are
// display-only, but stay authoritative here so every place we render a role
// in Dream tone (Director, not admin) reads from the same source.

// Mirrors supabase's app_role enum (0001_init.sql). Kept local so we don't
// depend on generated types — the enum values are tiny and rarely change.
export type AppRole = "admin" | "agent" | "conveyancer" | "client";

export const ROLE_ORDER: AppRole[] = ["admin", "agent", "conveyancer", "client"];

// Dream-facing label — "admin" is a technical role in Supabase; Bronwyn reads
// as a Director. Titles like "Sales & Marketing" live in app_user.job_title.
export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Director",
  agent: "Agent",
  conveyancer: "Conveyancer",
  client: "Client",
};

// One-line description of what each role can see. Used verbatim in the
// "What each role can see" panel on /team.
export const ROLE_ACCESS: Record<AppRole, string> = {
  admin:
    "Full access to every property, transfer, party, and document — plus team management.",
  agent:
    "Sees all business data. FICA, private client documents, and communications are only visible on transfers this agent leads.",
  conveyancer:
    "External. Reserved for scoped magic-link transfer rooms (not yet enabled) — a conveyancer only sees the deal they're conveyancing.",
  client:
    "External. Reserved for the buyer/seller portal (not yet enabled) — a client only sees their own transfer.",
};

// Role → pill palette. Kept on a white background (the /team table sits on
// var(--white)) so the topbar's dark-background .role-* classes don't apply
// here — those styles were tuned for the topbar's navy strip.
export const ROLE_PILL: Record<
  AppRole,
  { bg: string; border: string; fg: string }
> = {
  admin: {
    bg: "rgba(200,160,50,0.14)",
    border: "rgba(200,160,50,0.45)",
    fg: "#7A5814",
  },
  agent: {
    bg: "rgba(19,43,132,0.06)",
    border: "rgba(19,43,132,0.20)",
    fg: "var(--estuary)",
  },
  conveyancer: {
    bg: "rgba(28,91,58,0.08)",
    border: "rgba(28,91,58,0.25)",
    fg: "#1C5B3A",
  },
  client: {
    bg: "#f1f4fa",
    border: "#d7deef",
    fg: "#5b6885",
  },
};

export function isAppRole(v: unknown): v is AppRole {
  return v === "admin" || v === "agent" || v === "conveyancer" || v === "client";
}
