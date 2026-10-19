"use client";

import { useState, useTransition } from "react";
import { addRosterPerson, setAgentAccess } from "./actions";

// The agent roster with an access switch per agent (2026-10-19). Every agent
// from the website is listed; access starts OFF. Switching it on sends the
// invitation (or re-opens a login that was switched off); switching it off
// closes their access at once. Both ask once, inline, before acting.

export type RosterRow = {
  agentId: string;
  name: string;
  email: string;
  phone: string | null;
  listings: number;
  inviteRole: "agent" | "admin";
  state: "director" | "active" | "invited" | "off" | "none";
  invitedAt: string | null;
  lastSignIn: string | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : null;

function statusText(r: RosterRow): string {
  switch (r.state) {
    case "director":
      return "Director — full access";
    case "active":
      return `Access on${r.lastSignIn ? ` · last signed in ${fmt(r.lastSignIn)}` : ""}`;
    case "invited":
      return `Invited${r.invitedAt ? ` ${fmt(r.invitedAt)}` : ""} · hasn't signed in yet`;
    case "off":
      return "Access switched off";
    default:
      return r.inviteRole === "admin" ? "Director-to-be · not invited" : "No access · not invited";
  }
}

export default function AgentRoster({ rows }: { rows: RosterRow[] }) {
  const [list, setList] = useState(rows);
  return (
    <section className="roster" aria-labelledby="roster-h">
      <div className="roster-head">
        <h2 id="roster-h">The team</h2>
        <p>
          Everyone at Dream, loaded with access off — nobody is emailed until you switch them on. Switching on
          sends their invitation; switching off closes their access. Agents see their own listings and deals,
          and public facts for the rest; directors see everything.
        </p>
      </div>
      <ul className="roster-list" role="list">
        {list.map((r) => (
          <RosterItem key={r.agentId} row={r} />
        ))}
      </ul>
      <AddPerson onAdded={(r) => setList((l) => [...l, r].sort((a, b) => a.name.localeCompare(b.name)))} />
    </section>
  );
}

function AddPerson({ onAdded }: { onAdded: (r: RosterRow) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="roster-add-btn" onClick={() => setOpen(true)}>
        + Add someone to the list
      </button>
    );
  }
  return (
    <form
      className="roster-add"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const res = await addRosterPerson({ full_name: name, email, phone, role });
          if (!res.ok) {
            setErr(res.error);
            return;
          }
          onAdded({
            agentId: res.agentId,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim() || null,
            listings: 0,
            inviteRole: role,
            state: "none",
            invitedAt: null,
            lastSignIn: null,
          });
          setName("");
          setEmail("");
          setPhone("");
          setRole("agent");
          setOpen(false);
        });
      }}
    >
      <p className="roster-add-note">Added with access off. No email goes out until you switch them on.</p>
      <div className="roster-add-fields">
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          <span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </label>
        <label>
          <span>Access when switched on</span>
          <select value={role} onChange={(e) => setRole(e.target.value as "agent" | "admin")}>
            <option value="agent">Agent</option>
            <option value="admin">Director</option>
          </select>
        </label>
      </div>
      <div className="roster-add-go">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add to the list"}
        </button>
        <button type="button" className="roster-cancel" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {err && <p className="roster-err" role="alert">{err}</p>}
      </div>
    </form>
  );
}

function RosterItem({ row }: { row: RosterRow }) {
  const [r, setR] = useState(row);
  const [asking, setAsking] = useState<null | "on" | "off">(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const on = r.state === "active" || r.state === "invited" || r.state === "director";
  const first = r.name.split(" ")[0];

  function confirm(want: "on" | "off") {
    setErr(null);
    setNote(null);
    start(async () => {
      const res = await setAgentAccess({ agentId: r.agentId, on: want === "on" });
      setAsking(null);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (res.state === "invited") {
        setR({ ...r, state: "invited", invitedAt: new Date().toISOString() });
        setNote(`Invitation sent to ${r.email}.`);
      } else if (res.state === "on") {
        setR({ ...r, state: r.lastSignIn ? "active" : "invited" });
        setNote(`${first}'s access is on.`);
      } else {
        setR({ ...r, state: "off" });
        setNote(`${first}'s access is off.`);
      }
    });
  }

  return (
    <li className={`roster-item${on ? " is-on" : ""}`}>
      <div className="roster-who">
        <span className="roster-name">{r.name}</span>
        <span className="roster-meta">
          {r.email}
          {r.phone ? ` · ${r.phone}` : ""}
        </span>
        <span className="roster-meta">
          {r.listings} {r.listings === 1 ? "listing" : "listings"} · {statusText(r)}
        </span>
      </div>

      <div className="roster-act">
        {r.state === "director" ? (
          <span className="roster-pill">Director</span>
        ) : asking ? (
          <div className="roster-confirm" role="group" aria-label="Confirm">
            <span>
              {asking === "on"
                ? r.state === "none"
                  ? `Send ${first} an invitation to Dream OS${r.inviteRole === "admin" ? " as a director" : ""}?`
                  : `Switch ${first}'s access back on?`
                : `Switch off ${first}'s access now?`}
            </span>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => confirm(asking)}>
              {pending ? "Working…" : asking === "on" ? (r.state === "none" ? "Send invitation" : "Switch on") : "Switch off"}
            </button>
            <button type="button" className="roster-cancel" disabled={pending} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <label className="roster-switch">
            <input
              type="checkbox"
              role="switch"
              checked={on}
              onChange={() => setAsking(on ? "off" : "on")}
              aria-label={`Access for ${r.name}`}
            />
            <span className="roster-track" aria-hidden="true">
              <span className="roster-thumb" />
            </span>
            <span className="roster-switch-label">{on ? "Access on" : "Access off"}</span>
          </label>
        )}
        {note && <p className="roster-note" role="status">{note}</p>}
        {err && <p className="roster-err" role="alert">{err}</p>}
      </div>
    </li>
  );
}
