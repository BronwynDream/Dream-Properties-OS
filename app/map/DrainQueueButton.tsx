"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Drain the entire property24_url_queue by looping the refresh endpoint
// until pending === 0.
//
// Why this exists: MAX_DETAILS_PER_RUN is 12 per refresh invocation, and on
// Vercel Hobby the 60s function ceiling truncates each run to ~2-3 details
// before the platform returns a 504. Manually clicking "Refresh" 30+ times
// is a bad UX. This button auto-loops until the queue is empty, treating
// fetch errors as "the endpoint died mid-run but some rows may have been
// committed — poll queue-status, then loop again".
//
// Progress comes from the lightweight /queue-status endpoint (three head
// counts), so we get an accurate pending count regardless of whether the
// refresh call returned cleanly, 504'd, or the browser fetch aborted.

type QueueStatus = { pending: number; processed: number; total: number };

const POLL_MS = 2_000;                // status poll cadence between refreshes
const MAX_ITERATIONS = 300;           // hard safety cap (300 × 12 = 3,600 URLs)
const STALL_THRESHOLD = 3;            // give up after N consecutive no-progress rounds

async function fetchStatus(): Promise<QueueStatus | null> {
  try {
    const res = await fetch("/api/sources/property24/queue-status");
    if (!res.ok) return null;
    return (await res.json()) as QueueStatus;
  } catch {
    return null;
  }
}

async function callRefresh(signal: AbortSignal): Promise<void> {
  // We don't care about the response body — the next status poll is
  // authoritative. Swallow errors so a 504 (Hobby wall-time) doesn't stop
  // the loop; the server still committed some rows before dying.
  try {
    await fetch("/api/sources/property24/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
    });
  } catch {
    // Aborted or timed out — fine. Poll status next.
  }
}

export default function DrainQueueButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [iteration, setIteration] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  // Load initial status once on mount so the button label shows the queue
  // depth before the user clicks anything.
  useEffect(() => {
    fetchStatus().then(setStatus);
  }, []);

  async function drain() {
    setErr(null);
    setMsg(null);
    setRunning(true);
    stopRef.current = false;
    setIteration(0);

    const initial = await fetchStatus();
    setStatus(initial);
    if (!initial || initial.pending === 0) {
      setMsg("Queue already empty — nothing to drain.");
      setRunning(false);
      return;
    }

    let lastPending = initial.pending;
    let stallCount = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (stopRef.current) {
        setMsg(`Stopped at iteration ${i}. ${lastPending} still pending.`);
        break;
      }

      setIteration(i + 1);
      abortRef.current = new AbortController();
      await callRefresh(abortRef.current.signal);
      abortRef.current = null;

      // Breathe, then poll status. If status polling itself fails, wait
      // and try again on the next loop — one bad poll shouldn't abort.
      await new Promise((r) => setTimeout(r, POLL_MS));
      const now = await fetchStatus();
      if (now) {
        setStatus(now);
        if (now.pending === 0) {
          setMsg(
            `Drain complete in ${i + 1} iteration${i === 0 ? "" : "s"}. All ${now.total} URLs processed.`,
          );
          router.refresh();
          break;
        }
        if (now.pending >= lastPending) {
          stallCount++;
          if (stallCount >= STALL_THRESHOLD) {
            setErr(
              `Stalled: ${now.pending} pending, no progress in ${stallCount} rounds. Possible causes: Firecrawl rate limit, out of credits, or every remaining URL is failing. Check server logs.`,
            );
            break;
          }
        } else {
          stallCount = 0;
        }
        lastPending = now.pending;

        // Router refresh on each successful decrement so pins tick in
        // as they land. Cheap on the server (SSR page re-render).
        router.refresh();
      }
    }

    setRunning(false);
  }

  function stop() {
    stopRef.current = true;
    abortRef.current?.abort();
  }

  const buttonLabel = running
    ? `Draining… iter ${iteration}${status ? ` · ${status.pending} pending` : ""}`
    : status && status.pending > 0
    ? `Drain queue (${status.pending} pending)`
    : status && status.total > 0
    ? `Queue empty (${status.total} processed)`
    : "Drain queue";

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        className="ghost-dark"
        onClick={running ? stop : drain}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 12,
          justifyContent: "center",
        }}
        title="Loops the P24 refresh endpoint until every queued URL is processed. On Vercel Hobby, each call is capped at ~60s (2-3 URLs); expect ~2 hours for a full 366-URL backfill. Leave this tab open — closing it stops the drain. Uses Firecrawl credits per URL."
      >
        {running ? `${buttonLabel} · click to stop` : buttonLabel}
      </button>

      {status && !running && status.total > 0 && (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 11,
            color: "var(--estuary)",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.02em",
            opacity: 0.7,
          }}
        >
          {status.processed} / {status.total} processed
        </p>
      )}
      {msg && (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            color: "var(--estuary)",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.02em",
          }}
        >
          {msg}
        </p>
      )}
      {err && (
        <p className="error" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {err}
        </p>
      )}
    </div>
  );
}
