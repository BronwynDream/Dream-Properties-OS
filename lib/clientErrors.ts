"use client";

import { logClientError } from "@/app/feedback/actions";

// Client-side error capture (2026-10-19). Crashes, unhandled promise
// failures and server errors (HTTP 5xx from our own pages and APIs) are sent
// to app_feedback so a director sees them without anyone reporting them.
// The last few are kept in memory and attached to "Something's not right"
// reports for context.

const recent: string[] = [];
const seen = new Set<string>();
let sent = 0;
let sending = false;
const MAX_PER_LOAD = 10;

const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND/,
  /AbortError|The user aborted a request|signal is aborted/i,
  /chrome-extension:|moz-extension:|safari-web-extension:/i,
];

export function pageContext() {
  if (typeof window === "undefined") return { path: "" };
  return {
    path: window.location.pathname + window.location.search,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    userAgent: navigator.userAgent,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    recentErrors: [...recent],
  };
}

export function captureError(source: string, err: unknown, extra: { digest?: string } = {}) {
  try {
    const e = err as { message?: string; stack?: string } | undefined;
    const message = (typeof err === "string" ? err : e?.message) || String(err ?? "Unknown error");
    const stack = e?.stack ?? "";
    if (NOISE.some((r) => r.test(message) || r.test(stack))) return;
    recent.push(message.slice(0, 300));
    if (recent.length > 5) recent.shift();
    const key = `${source}|${message}|${window.location.pathname}`;
    if (seen.has(key) || sent >= MAX_PER_LOAD || sending) return;
    seen.add(key);
    sent++;
    sending = true;
    logClientError({ source, message, stack, digest: extra.digest, ...pageContext() })
      .catch(() => {})
      .finally(() => {
        sending = false;
      });
  } catch {
    /* never throw from the error catcher */
  }
}

let installed = false;
export function installErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => captureError("window", ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => captureError("promise", ev.reason));
  // Server errors from our own site (APIs and server actions).
  const orig = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await orig(...args);
    try {
      if (res.status >= 500 && !sending) {
        const req = args[0];
        const url = new URL(typeof req === "string" ? req : req instanceof URL ? req.href : req.url, window.location.href);
        if (url.origin === window.location.origin) {
          const method = (args[1]?.method ?? (req instanceof Request ? req.method : "GET")).toUpperCase();
          const isAction = !!new Headers(args[1]?.headers ?? (req instanceof Request ? req.headers : undefined)).get("next-action");
          captureError("server", `Server error ${res.status} on ${method} ${isAction ? `${url.pathname} (save/action)` : url.pathname}`);
        }
      }
    } catch {
      /* ignore */
    }
    return res;
  };
}
