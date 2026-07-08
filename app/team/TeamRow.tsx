"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTeamMember } from "./actions";
import { ROLE_LABEL, ROLE_ORDER, ROLE_PILL, type AppRole } from "./roles";

export type TeamMember = {
  id: string;
  full_name: string;
  email: string | null;
  role: AppRole;
  job_title: string | null;
  phone: string | null;
  active: boolean;
  ppra_ffc: string | null;
  transfers_led: number;
};

// One editable row of the staff table. Inline editing keeps the shape of the
// screen simple — no modal, no navigation. Save is per-row so Bronwyn can
// tweak Vanessa's job title without disturbing other rows.
//
// Self-lockout: the row for the current session's user hides destructive
// controls (role away from Director + deactivate). The Save button still
// works for job_title and phone edits on your own row.
export default function TeamRow({
  member,
  isSelf,
}: {
  member: TeamMember;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [role, setRole] = useState<AppRole>(member.role);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [active, setActive] = useState(member.active);

  const dirty =
    role !== member.role ||
    jobTitle !== (member.job_title ?? "") ||
    phone !== (member.phone ?? "") ||
    active !== member.active;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateTeamMember({
        userId: member.id,
        role,
        job_title: jobTitle,
        phone,
        active,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setOk(true);
      router.refresh();
      setTimeout(() => setOk(false), 2400);
    });
  }

  const pill = ROLE_PILL[member.role];

  return (
    <tr style={{ opacity: member.active ? 1 : 0.55 }}>
      <td className="strong" style={{ minWidth: 180 }}>
        <div>{member.full_name}</div>
        {member.email && (
          <div
            className="mono"
            style={{ fontSize: 11, color: "#7a86a8", marginTop: 2 }}
          >
            {member.email}
          </div>
        )}
      </td>
      <td style={{ minWidth: 200 }}>
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Sales & Marketing"
          disabled={pending}
          style={inputStyle}
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+27 …"
          disabled={pending}
          style={{ ...inputStyle, marginTop: 6 }}
        />
      </td>
      <td style={{ minWidth: 160 }}>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AppRole)}
          disabled={pending || (isSelf && member.role === "admin")}
          style={inputStyle}
          aria-label="Access role"
        >
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {isSelf && role === "admin" && (
          <div
            style={{
              fontSize: 10,
              color: "#7a86a8",
              marginTop: 4,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            you
          </div>
        )}
        <span
          style={{
            display: "inline-block",
            marginTop: 6,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            background: pill.bg,
            border: `1px solid ${pill.border}`,
            color: pill.fg,
          }}
        >
          {ROLE_LABEL[member.role]}
        </span>
      </td>
      <td className="mono" style={{ fontSize: 12, minWidth: 110 }}>
        {member.ppra_ffc ?? "—"}
      </td>
      <td style={{ minWidth: 60, textAlign: "right" }}>
        {member.transfers_led}
      </td>
      <td style={{ minWidth: 110 }}>
        {isSelf ? (
          <span style={{ fontSize: 12, color: "#7a86a8" }}>Always on</span>
        ) : (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--estuary)",
              cursor: "pointer",
              margin: 0,
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={pending}
            />
            {active ? "Active" : "Inactive"}
          </label>
        )}
      </td>
      <td style={{ minWidth: 100, textAlign: "right" }}>
        <form onSubmit={submit} style={{ margin: 0 }}>
          <button
            type="submit"
            className={dirty ? "cta" : "ghost-dark"}
            disabled={pending || !dirty}
            style={{ padding: "6px 12px", fontSize: 12 }}
          >
            {pending ? "Saving…" : ok ? "Saved" : "Save"}
          </button>
        </form>
        {err && (
          <div
            className="error"
            style={{ marginTop: 6, fontSize: 11, textAlign: "left" }}
          >
            {err}
          </div>
        )}
      </td>
    </tr>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #d7deef",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fbfcfe",
};
