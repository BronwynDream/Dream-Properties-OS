// Viewing vocabulary shared between /viewings, property records, and
// server actions. Kept as a plain library so both server and client
// components can pull labels + colour tokens without duplicating strings.

export type ViewingKind = "show_house" | "private_viewing" | "valuation_visit";
export type ViewingStatus = "scheduled" | "completed" | "cancelled";

export const VIEWING_KIND_LABEL: Record<ViewingKind, string> = {
  show_house: "Show house",
  private_viewing: "Private viewing",
  valuation_visit: "Valuation visit",
};

export const VIEWING_KIND_HELP: Record<ViewingKind, string> = {
  show_house: "Publicly advertised — walk-ins expected",
  private_viewing: "Booked with a specific buyer",
  valuation_visit: "Agent to seller — pricing / take-on",
};

// Colour cues per kind — different weight to differentiate at a glance
// on the weekly grid.
export const VIEWING_KIND_STRIPE: Record<ViewingKind, string> = {
  show_house: "var(--accent-600, #132B84)",   // Dream's navy — this is our staple
  private_viewing: "var(--caution, #A9772F)", // one-to-one, less predictable
  valuation_visit: "#6B7A45",                  // agent-facing chore
};

// Format an ISO datetime as "Sun 09 Aug · 14:00" (SA convention).
export function formatViewingTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-ZA", { weekday: "short" });
  const dm = d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
  const hm = d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${dm} · ${hm}`;
}

export function formatWeekOf(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
}

// Return the local-midnight Date for Monday of the week containing `ref`.
// Bronwyn thinks in Mon-Sun weeks; Sunday afternoon is the show-house day
// so it sits as the RIGHTMOST column of the grid — which matches the
// "weekend at the end" mental model for a working week.
export function mondayOf(ref: Date): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday
  const delta = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + delta);
  return d;
}

// Given a Monday-anchor date, produce 7 successive Date objects Mon → Sun.
export function weekDaysFrom(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}
