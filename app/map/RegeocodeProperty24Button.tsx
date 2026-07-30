"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual admin trigger to re-geocode every Property24 row via P24's own
// schema.org JSON-LD block (parsed from the listing detail page HTML).
// This is P24's canonical source-of-truth — the same coords render P24's
// map widget — so pins are cadastrally correct by construction.
//
// Replaces the earlier Mapbox-first / muni-ERF chain (both of which
// covered maybe 30-50% of listings). JSON-LD covers ~all listings.
//
// Firecrawl-bounded to 15 rows per invocation (Vercel Pro caps functions
// at 300s and each detail scrape is ~15s). Show "N pending" in the
// success message so the admin knows to click again to drain the queue.
// Idempotent — safe to re-run any time; nulls prcl_key so the auto-snap
// trigger re-binds each row to its true cadastre polygon.

type RegeocodeJsonLdResponse = {
  ok?: boolean;
  scanned?: number;
  hitJsonLd?: number;
  unchanged?: number;
  noHit?: number;
  noHitReasons?: Record<string, { count: number; sampleUrls: string[] }>;
  updated?: number;
  changeCount?: number;
  changes?: { moved_km: number }[];
  note?: string;
  error?: string;
};

export default function RegeocodeProperty24Button() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sources/property24/regeocode-jsonld", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as RegeocodeJsonLdResponse;
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const worstMove = json.changes?.[0]?.moved_km;
        const worstPart =
          worstMove != null && worstMove > 0.5
            ? ` · biggest move ${worstMove}km`
            : "";
        const remainingPart =
          (json.scanned ?? 0) >= 15
            ? " · click again to continue"
            : " · queue drained";
        setMsg(
          `Updated ${json.updated ?? 0} of ${json.scanned ?? 0} · ${json.hitJsonLd ?? 0} JSON-LD hits · ${json.unchanged ?? 0} unchanged · ${json.noHit ?? 0} no-hit${worstPart}${remainingPart}`,
        );
        router.refresh();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="ghost-dark"
        onClick={run}
        disabled={pending}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 12,
          justifyContent: "center",
        }}
        title="Re-scrapes each Property24 row's detail page and extracts coords from schema.org JSON-LD (P24's own map data). Firecrawl-bounded to 15 rows per click — re-click to drain the queue. Idempotent; nulls prcl_key so the auto-snap trigger re-binds each row to its true cadastre polygon."
      >
        {pending ? "Re-scraping Property24 JSON-LD (may take up to 5 min)…" : "Re-geocode Property24"}
      </button>

      {msg && (
        <p
          style={{
            margin: "8px 0 0",
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
        <p className="error" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {err}
        </p>
      )}
    </div>
  );
}
