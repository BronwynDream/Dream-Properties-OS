// The data feeds Dream OS depends on, and what "healthy" means for each.
//
// This is the single list the Data Health page (/admin/health) renders and
// the map's source chips consult. Adding a feed = add a row here + call
// recordFeedRun() from its route. Keys are stored in feed_run.feed, so
// don't rename one without a data migration.

export type FeedKey =
  | "dream_website"
  | "property24"
  | "private_property"
  | "muni_roll"
  | "geocode"
  | "intake_email";

export type FeedDef = {
  key: FeedKey;
  label: string;
  /** One line for the health page: what this feed brings in. */
  what: string;
  /** How often it should run. Drives amber/red when the last run is older. */
  cadence: "daily" | "weekly" | "on_demand" | "event";
  /** The map source chip this feed backs, if any. */
  mapSource?: "dream_website" | "property24" | "private_property" | "dream_os";
  /** Admin-triggerable endpoint (POST). Absent = no manual trigger. */
  route?: string;
  /** Not built yet — always red, and the page says so. */
  planned?: boolean;
};

export const FEEDS: FeedDef[] = [
  {
    key: "dream_website",
    label: "Dream website",
    what: "Scrapes dreamknysna.co.za for Dream's own listings and geocodes them.",
    cadence: "daily",
    mapSource: "dream_website",
    route: "/api/sources/dream/refresh",
  },
  {
    key: "property24",
    label: "Property24 index",
    what: "Discovers Knysna listings on Property24 and drains their detail pages through Firecrawl. Each run does one batch; the queue depth shows what is left.",
    cadence: "weekly",
    mapSource: "property24",
    route: "/api/sources/property24/refresh",
  },
  {
    key: "private_property",
    label: "Private Property",
    what: "Not built. Private Property listings are not ingested yet.",
    cadence: "weekly",
    mapSource: "private_property",
    planned: true,
  },
  {
    key: "muni_roll",
    label: "Municipal valuation roll",
    what: "Imports Knysna Municipality's rateable-property mirror (valuation, finance, deeds).",
    cadence: "weekly",
    route: "/api/muni/import",
  },
  {
    key: "geocode",
    label: "Geocoding and cadastral snap",
    what: "Pins properties and external listings that have an address but no coordinates, then snaps them to erven.",
    cadence: "on_demand",
  },
  {
    key: "intake_email",
    label: "Inbound email",
    what: "Emails forwarded to the intake address arrive here as triage batches.",
    cadence: "event",
    route: "/api/intake/email",
  },
];

export const FEED_BY_KEY: Record<FeedKey, FeedDef> = Object.fromEntries(
  FEEDS.map((f) => [f.key, f]),
) as Record<FeedKey, FeedDef>;

export type Light = "green" | "amber" | "red" | "grey";

export type FeedLatest = {
  feed: FeedKey;
  status: "running" | "ok" | "partial" | "error";
  trigger: "cron" | "manual" | "webhook";
  started_at: string;
  finished_at: string | null;
  items: number | null;
  error: string | null;
};

const HOUR = 3600_000;

/** Age thresholds per cadence: [amber after, red after] in hours. */
const STALE: Record<FeedDef["cadence"], [number, number]> = {
  daily: [36, 72],
  weekly: [8 * 24, 15 * 24],
  on_demand: [30 * 24, 90 * 24],
  event: [14 * 24, 45 * 24],
};

/**
 * Turn the latest run into a light. Pure, so the map and the health page
 * agree. A feed with no run at all is grey ("never run"), not red — red is
 * reserved for "ran and failed" or "planned, not built".
 */
export function feedLight(def: FeedDef, latest: FeedLatest | undefined, now = Date.now()): Light {
  if (def.planned) return "red";
  if (!latest) return "grey";
  if (latest.status === "error") return "red";
  if (latest.status === "running") {
    // A run that never finished is a crash, not a run in progress.
    return now - Date.parse(latest.started_at) > 2 * HOUR ? "red" : "amber";
  }
  const [amberH, redH] = STALE[def.cadence];
  const ageH = (now - Date.parse(latest.finished_at ?? latest.started_at)) / HOUR;
  if (ageH > redH) return "red";
  if (ageH > amberH || latest.status === "partial") return "amber";
  return "green";
}
