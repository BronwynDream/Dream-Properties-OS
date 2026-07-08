/* eslint-disable @typescript-eslint/no-explicit-any */

import { createServiceClient } from "@/lib/supabase/service";
import { notifyAdmins } from "@/lib/notify";

// The one true entry point for hitting the Lightstone Azure API Management
// gateway. Every billable call MUST go through guardedGet() — the take-on
// Fetch flow and the Market layer both use it. Callers pass:
//
//   - path: the URL path suffix on the gateway (e.g. "/lspdata/v1/property/999/legal").
//   - meta.endpoint: a short logical bucket for the ledger ("legal", "avm",
//     "address_search"), so admins can see which facets are eating the budget.
//   - meta.billable: default true. Property Search and health checks are cheap
//     / free per Lightstone's docs — mark those false.
//   - meta.lightstonePropertyId / ourPropertyId / userId: bookkeeping.
//
// Auth to Lightstone (Ocp-Apim-Subscription-Key) reads the same env vars as
// live.ts used to — LIGHTSTONE_API_BASE + LIGHTSTONE_API_KEY. Bookkeeping
// always uses createServiceClient() so writes bypass RLS even without a user
// session (e.g. the nightly cache-warm the Market layer will eventually run).

export type GuardedMeta = {
  endpoint: string;
  lightstonePropertyId?: number;
  ourPropertyId?: string;
  userId?: string;
  billable?: boolean;
};

export class BudgetReachedError extends Error {
  readonly code = "BUDGET_REACHED";
  constructor(msg?: string) {
    super(msg ?? "Lightstone monthly budget reached — ask a Director to raise it");
    this.name = "BudgetReachedError";
  }
}

// -----------------------------------------------------------------------------
// Public: budget summary — used by the map rail spend meter.
// -----------------------------------------------------------------------------

export type BudgetSummary = {
  used: number;
  budget: number;
  softWarnPct: number;
  pctUsed: number;              // 0–100, clamped
  monthKey: string;
  alertedSoft: boolean;
  alertedHard: boolean;
};

export async function getBudgetSummary(): Promise<BudgetSummary | null> {
  const supabase = createServiceClient();
  const { data: budget } = await supabase
    .from("lightstone_budget")
    .select("monthly_call_budget, soft_warn_pct, month_key, alerted_soft, alerted_hard")
    .eq("id", true)
    .maybeSingle();
  if (!budget) return null;

  const monthKey = currentMonthKey();
  // If the singleton is stale (month has rolled over but no call yet), report
  // used=0 against the OLD month_key — the next guardedGet call resets it.
  // For the meter we just want honest live numbers.
  const key = budget.month_key === monthKey ? budget.month_key : monthKey;
  const used = await countBillableThisMonth(supabase, key);
  const b = Number(budget.monthly_call_budget) || 0;

  return {
    used,
    budget: b,
    softWarnPct: Number(budget.soft_warn_pct) || 80,
    pctUsed: b > 0 ? Math.min(100, Math.round((used / b) * 100)) : 0,
    monthKey: key,
    alertedSoft: !!budget.alerted_soft,
    alertedHard: !!budget.alerted_hard,
  };
}

// -----------------------------------------------------------------------------
// Public: the gateway itself.
// -----------------------------------------------------------------------------

export async function guardedGet(
  path: string,
  meta: GuardedMeta,
): Promise<any> {
  const billable = meta.billable !== false; // default true
  const supabase = createServiceClient();

  // Rollover on month change — reset the alert flags so we can fire once more
  // on the new month. Do this BEFORE the count so we count against a fresh
  // month if this is the first call after midnight-UTC on the 1st.
  const monthKey = currentMonthKey();
  const { data: budget } = await supabase
    .from("lightstone_budget")
    .select("monthly_call_budget, soft_warn_pct, month_key, alerted_soft, alerted_hard")
    .eq("id", true)
    .maybeSingle();
  if (!budget) {
    // Missing singleton — the migration wasn't applied. Fail loud rather
    // than silently ignore the budget system.
    throw new Error("lightstone_budget singleton missing — apply 0026");
  }
  if (budget.month_key !== monthKey) {
    await supabase
      .from("lightstone_budget")
      .update({
        month_key: monthKey,
        alerted_soft: false,
        alerted_hard: false,
      })
      .eq("id", true);
    budget.month_key = monthKey;
    budget.alerted_soft = false;
    budget.alerted_hard = false;
  }

  // Non-billable calls skip the meter but still get a ledger row so we can
  // see what's being called.
  if (!billable) {
    return doFetchAndLog(supabase, path, meta, {
      billable: false,
      cache_hit: false,
      blocked: false,
    });
  }

  // Billable — check the cap.
  const used = await countBillableThisMonth(supabase, monthKey);
  const cap = Number(budget.monthly_call_budget) || 0;
  if (used >= cap) {
    // Block: ledger the attempt as blocked (not billable, since we never
    // spent the call), then throw the typed error.
    await insertLedger(supabase, path, meta, {
      billable: false,
      cache_hit: false,
      blocked: true,
      error: "monthly budget reached",
    });
    throw new BudgetReachedError();
  }

  // Do the fetch and log a billable row.
  const result = await doFetchAndLog(supabase, path, meta, {
    billable: true,
    cache_hit: false,
    blocked: false,
  });

  // Threshold alerts — fire after the ledger is written so the count reflects
  // this call. Re-read count from the DB rather than trusting `used + 1`
  // (another request may have raced us in the last few milliseconds).
  const nowUsed = await countBillableThisMonth(supabase, monthKey);
  const softAt = Math.floor((cap * (Number(budget.soft_warn_pct) || 80)) / 100);
  if (nowUsed >= softAt && !budget.alerted_soft) {
    await sendThresholdEmail("soft", nowUsed, cap, budget.soft_warn_pct);
    await supabase.from("lightstone_budget").update({ alerted_soft: true }).eq("id", true);
  }
  if (nowUsed >= cap && !budget.alerted_hard) {
    await sendThresholdEmail("hard", nowUsed, cap, budget.soft_warn_pct);
    await supabase.from("lightstone_budget").update({ alerted_hard: true }).eq("id", true);
  }

  return result;
}

// -----------------------------------------------------------------------------
// Private helpers
// -----------------------------------------------------------------------------

function currentMonthKey(): string {
  // Match the DB's month_key: YYYY-MM in UTC.
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function apiBase(): string {
  const b = (process.env.LIGHTSTONE_API_BASE ?? "").trim();
  if (!b) throw new Error("LIGHTSTONE_API_BASE is not set");
  return b.replace(/\/+$/, "");
}
function apiKey(): string {
  const k = (process.env.LIGHTSTONE_API_KEY ?? "").trim();
  if (!k) throw new Error("LIGHTSTONE_API_KEY is not set");
  return k;
}

async function countBillableThisMonth(
  supabase: ReturnType<typeof createServiceClient>,
  monthKey: string,
): Promise<number> {
  const { count } = await supabase
    .from("lightstone_usage")
    .select("id", { count: "exact", head: true })
    .eq("month_key", monthKey)
    .eq("billable", true)
    .eq("cache_hit", false)
    .eq("blocked", false);
  return count ?? 0;
}

type LedgerFlags = {
  billable: boolean;
  cache_hit: boolean;
  blocked: boolean;
  http_status?: number;
  error?: string;
};

async function insertLedger(
  supabase: ReturnType<typeof createServiceClient>,
  path: string,
  meta: GuardedMeta,
  flags: LedgerFlags,
): Promise<void> {
  await supabase.from("lightstone_usage").insert({
    path,
    endpoint: meta.endpoint,
    billable: flags.billable,
    cache_hit: flags.cache_hit,
    blocked: flags.blocked,
    http_status: flags.http_status ?? null,
    error: flags.error ?? null,
    user_id: meta.userId ?? null,
    our_property_id: meta.ourPropertyId ?? null,
    lightstone_property_id: meta.lightstonePropertyId ?? null,
  });
}

// Raw HTTP call to Lightstone, plus ledger insertion. Kept in one place so
// we can never accidentally spend a call without logging it.
async function doFetchAndLog(
  supabase: ReturnType<typeof createServiceClient>,
  path: string,
  meta: GuardedMeta,
  flags: LedgerFlags,
): Promise<any> {
  let httpStatus = 0;
  let errMsg: string | null = null;
  let data: any = null;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey(),
        "Cache-Control": "no-cache",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    httpStatus = res.status;
    const text = await res.text();
    if (!res.ok) {
      // Surface Lightstone's message + activityId — support traces by activityId.
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        if (j?.message) {
          detail = `${j.message}${j.activityId ? ` (activityId ${j.activityId})` : ""}`;
        }
      } catch {
        /* keep raw text */
      }
      errMsg = `Lightstone ${path} → HTTP ${res.status}: ${detail}`;
      await insertLedger(supabase, path, meta, {
        ...flags,
        http_status: httpStatus,
        error: errMsg,
      });
      throw new Error(errMsg);
    }
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    if (errMsg == null) {
      // Network-level error, not a Lightstone 4xx/5xx we already logged.
      errMsg = (e as Error).message;
      await insertLedger(supabase, path, meta, {
        ...flags,
        http_status: httpStatus || undefined,
        error: errMsg,
      });
    }
    throw e;
  }

  // Success path — log now.
  await insertLedger(supabase, path, meta, {
    ...flags,
    http_status: httpStatus,
  });
  return data;
}

async function sendThresholdEmail(
  kind: "soft" | "hard",
  used: number,
  cap: number,
  softPct: number,
): Promise<void> {
  const monthKey = currentMonthKey();
  const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
  const subject =
    kind === "hard"
      ? `[Dream OS] Lightstone budget REACHED — pulls paused (${used}/${cap})`
      : `[Dream OS] Lightstone budget at ${pct}% (${used}/${cap})`;
  const body =
    kind === "hard"
      ? [
          `Lightstone monthly call budget reached for ${monthKey}.`,
          ``,
          `  Used   : ${used}`,
          `  Budget : ${cap}`,
          ``,
          `Every further billable Lightstone call is BLOCKED until the budget`,
          `is raised or the month rolls over. Take-on Fetch and Market calls`,
          `will return a "budget reached" error to the agent.`,
          ``,
          `Raise the budget in /team (Director tools) or update lightstone_budget`,
          `directly in Supabase.`,
        ].join("\n")
      : [
          `Lightstone spending is at ${pct}% of the monthly budget for ${monthKey}.`,
          ``,
          `  Used   : ${used}`,
          `  Budget : ${cap}`,
          `  Warn   : ${softPct}%`,
          ``,
          `Nothing is blocked yet — pulls will keep flowing until the budget is`,
          `hit. This is the one-time heads-up for the month; the next email`,
          `only fires when the hard cap is reached.`,
        ].join("\n");

  await notifyAdmins(subject, body);
}
