"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const LINK_ERRORS: Record<string, string> = {
  other_browser:
    "That reset link opened in a different browser from the one you asked for it in. Tap “Forgot your password?” again from this browser and use the new email.",
  link_expired: "That email link has expired or was already used. Tap “Forgot your password?” to get a new one.",
  link_incomplete: "That email link is incomplete. Tap “Forgot your password?” to get a new one.",
  missing_code: "That email link didn't sign you in. Tap “Forgot your password?” to get a new one.",
  link_failed: "That email link didn't work. Tap “Forgot your password?” to get a new one.",
};

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Arriving from an email link that didn't work, or from an older-style
  // invitation whose session rides in the #hash (2026-10-19: Simon's reset
  // link "takes me straight back to the original login page").
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    if (access && refresh) {
      setLoading(true);
      supabase.auth.setSession({ access_token: access, refresh_token: refresh }).then(({ error }) => {
        if (error) {
          setLoading(false);
          setError(LINK_ERRORS.link_expired);
          return;
        }
        window.location.assign("/account/password");
      });
      return;
    }
    const hashErr = hash.get("error_description");
    const code = new URLSearchParams(window.location.search).get("error");
    if (hashErr) setError(/expired|invalid/i.test(hashErr) ? LINK_ERRORS.link_expired : LINK_ERRORS.link_failed);
    else if (code) setError(LINK_ERRORS[code] ?? LINK_ERRORS.link_failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Full navigation so the server re-reads the freshly-set auth cookie.
    // (Soft router navigation here races the cookie write and can hang.)
    window.location.assign("/dashboard");
  }

  return (
    <main className="auth-wrap">
      <div className="card">
        <div className="card-head">
          <p className="eyebrow">Dream Knysna</p>
          <h1>Properties OS</h1>
        </div>
        <hr className="tideline" />
        <div className="card-body">
          <form onSubmit={onSubmit}>
            {error && <div className="error">{error}</div>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <p className="auth-alt">
              <Link href="/forgot-password">Forgot your password?</Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
