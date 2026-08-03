"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const origin = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/account/password`,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <main className="auth-wrap">
      <div className="card">
        <div className="card-head">
          <p className="eyebrow">Dream Knysna</p>
          <h1>Reset password</h1>
        </div>
        <hr className="tideline" />
        <div className="card-body">
          {sent ? (
            <>
              <p style={{ marginTop: 0 }}>
                If <strong>{email}</strong> is on the team, we&rsquo;ve sent a
                recovery link. Open the email and click through to set a new
                password.
              </p>
              <p className="auth-alt">
                <Link href="/login">Back to sign in</Link>
              </p>
            </>
          ) : (
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
              <button className="primary" type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send recovery email"}
              </button>
              <p className="auth-alt">
                <Link href="/login">Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
