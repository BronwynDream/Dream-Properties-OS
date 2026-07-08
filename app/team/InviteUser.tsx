"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember } from "./actions";
import { ROLE_LABEL, ROLE_ORDER, type AppRole } from "./roles";

// Collapsible invite panel. Same layout language as NewPropertyForm — a plain
// "+ Invite team member" CTA when closed, an inline form when open. Supabase
// sends the "set your password" email; on success we refresh so the new row
// appears in the staff table (they show as active immediately, even before
// they've clicked through).
export default function InviteUser() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("agent");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setEmail("");
    setFullName("");
    setRole("agent");
    setJobTitle("");
    setPhone("");
    setErr(null);
    setMsg(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await inviteTeamMember({
        email,
        full_name: fullName,
        role,
        job_title: jobTitle,
        phone,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Invite sent to ${email}. They'll get an email to set a password.`);
      router.refresh();
      // Close after a short beat so the confirmation is visible.
      setTimeout(() => {
        reset();
        setOpen(false);
      }, 2600);
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cta"
          onClick={() => setOpen(true)}
          style={{ padding: "9px 14px", fontSize: 13 }}
        >
          + Invite team member
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--white)",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
        display: "grid",
        gridTemplateColumns: "1.4fr 1.4fr 1fr 1.2fr 1fr auto",
        gap: 10,
        alignItems: "end",
      }}
    >
      <div style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
        <p
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--gold)",
            margin: 0,
          }}
        >
          Invite
        </p>
        <h3
          style={{
            fontFamily: "Inter, -apple-system, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "var(--estuary)",
            margin: "4px 0 0",
          }}
        >
          Add a Dream team member.
        </h3>
      </div>

      <label>
        <span style={fieldLabel}>Full name *</span>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Camilla Eyre"
          required
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <label>
        <span style={fieldLabel}>Email *</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="camilla@dreamknysna.co.za"
          required
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <label>
        <span style={fieldLabel}>Access</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AppRole)}
          disabled={pending}
          style={inputStyle}
        >
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span style={fieldLabel}>Job title</span>
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Sales & Marketing"
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <label>
        <span style={fieldLabel}>Phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+27 …"
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="cta"
          disabled={pending}
          style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          style={{ padding: "9px 12px", fontSize: 13 }}
        >
          Cancel
        </button>
      </div>

      {msg && (
        <p
          style={{
            gridColumn: "1 / -1",
            margin: "4px 0 0",
            color: "var(--estuary)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {msg}
        </p>
      )}
      {err && (
        <p
          className="error"
          style={{ gridColumn: "1 / -1", margin: "4px 0 0" }}
        >
          {err}
        </p>
      )}
    </form>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6b78a0",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d7deef",
  borderRadius: 7,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#fbfcfe",
};
