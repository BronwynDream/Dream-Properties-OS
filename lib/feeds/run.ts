// Server-only: imports the service-role client. Never import from a client component.
import { createServiceClient } from "@/lib/supabase/service";
import type { FeedKey } from "./registry";

// Record a feed run around an existing route handler without touching the
// handler's internals. The route keeps returning its own JSON; we read the
// response (cloned) to decide ok / partial / error and to pull an item
// count out of whichever field the route uses.
//
// Trigger is inferred from the request: a bearer token means Vercel Cron,
// a Svix signature means the email webhook, anything else is an admin
// clicking a button.
//
// Logging must never break the feed: every write here is best-effort and
// swallowed with a console.warn. A feed that runs but fails to log is a
// health-page problem; a feed that fails because logging threw is a data
// problem, and the second is worse.

type Trigger = "cron" | "manual" | "webhook";

const ITEM_FIELDS = [
  "upserted", "inserted", "imported", "rows", "geocoded", "processed", "files", "count", "queued",
];

function inferTrigger(request: Request): Trigger {
  const h = request.headers;
  if (h.get("svix-id") || h.get("svix-signature")) return "webhook";
  if ((h.get("authorization") ?? "").startsWith("Bearer ")) return "cron";
  return "manual";
}

function pickItems(json: Record<string, unknown> | null): number | null {
  if (!json) return null;
  for (const k of ITEM_FIELDS) {
    const v = json[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export async function recordFeedRun(
  feed: FeedKey,
  request: Request,
  handler: () => Promise<Response>,
  opts: { triggeredBy?: string | null } = {},
): Promise<Response> {
  let service: ReturnType<typeof createServiceClient> | null = null;
  let runId: string | null = null;
  try {
    service = createServiceClient();
    const { data } = await service
      .from("feed_run")
      .insert({ feed, trigger: inferTrigger(request), triggered_by: opts.triggeredBy ?? null })
      .select("id")
      .single();
    runId = data?.id ?? null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[feed_run] start ${feed}: ${(e as Error).message}`);
  }

  let response: Response;
  try {
    response = await handler();
  } catch (e) {
    await finish(service, runId, "error", null, null, (e as Error).message ?? String(e));
    throw e;
  }

  // Auth failures are not runs. Leave the row as 'error' with the reason so
  // a misconfigured CRON_SECRET shows up on the health page, but don't
  // count it against the feed's item history.
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    json = null;
  }

  const errors = Array.isArray(json?.errors) ? (json!.errors as unknown[]) : [];
  const status: "ok" | "partial" | "error" =
    !response.ok || json?.ok === false || typeof json?.error === "string"
      ? "error"
      : errors.length > 0
      ? "partial"
      : "ok";
  const errText =
    status === "error"
      ? (typeof json?.error === "string" ? json.error : `HTTP ${response.status}`)
      : errors.length > 0
      ? errors.map(String).join(" | ").slice(0, 2000)
      : null;

  await finish(service, runId, status, pickItems(json), json, errText);
  return response;
}

async function finish(
  service: ReturnType<typeof createServiceClient> | null,
  runId: string | null,
  status: "ok" | "partial" | "error",
  items: number | null,
  summary: Record<string, unknown> | null,
  error: string | null,
) {
  if (!service || !runId) return;
  try {
    await service
      .from("feed_run")
      .update({
        status,
        finished_at: new Date().toISOString(),
        items,
        summary: summary ? trimSummary(summary) : null,
        error,
      })
      .eq("id", runId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[feed_run] finish ${runId}: ${(e as Error).message}`);
  }
}

// Keep summaries small: scalars and short arrays only. Routes sometimes
// return long error lists or per-row detail that doesn't belong in a
// health row.
function trimSummary(j: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(j)) {
    if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 300) : x));
  }
  return out;
}
