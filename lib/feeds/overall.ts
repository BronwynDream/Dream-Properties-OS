import type { SupabaseClient } from "@supabase/supabase-js";
import { FEEDS, feedLight, type FeedLatest, type Light } from "./registry";

/** One light for all the feeds that exist: the worst of them. Planned
 *  feeds are roadmap items, not problems, and are left out. */
export async function overallFeedLight(supabase: SupabaseClient): Promise<Light> {
  const { data } = await supabase.from("v_feed_latest").select("feed, status, trigger, started_at, finished_at, items, error");
  const latest = new Map<string, FeedLatest>();
  for (const r of ((data ?? []) as FeedLatest[])) latest.set(r.feed, r);
  const lights = FEEDS.filter((f) => !f.planned).map((f) => feedLight(f, latest.get(f.key)));
  return lights.includes("red") ? "red" : lights.includes("amber") ? "amber" : lights.includes("grey") ? "grey" : "green";
}
