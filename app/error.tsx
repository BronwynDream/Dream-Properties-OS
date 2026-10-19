"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/clientErrors";

// Any page that crashes lands here (2026-10-19). The crash is logged to
// Admin → Reports automatically; the agent gets a plain way out.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError("page", error, { digest: error.digest });
  }, [error]);

  return (
    <main className="auth-wrap">
      <div className="card">
        <div className="card-head">
          <p className="eyebrow">Dream Knysna</p>
          <h1>This page hit a problem</h1>
        </div>
        <hr className="tideline" />
        <div className="card-body">
          <p style={{ marginTop: 0 }}>It&apos;s been logged for Simon automatically — you don&apos;t need to report it. Try again, or go back to the dashboard.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={reset}>
              Try again
            </button>
            <a className="btn-secondary" href="/dashboard">
              Dashboard
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
