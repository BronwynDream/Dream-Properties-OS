"use client";

import { useState, useTransition } from "react";
import { setAgentAccess } from "./actions";

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
      return "No access · not invited";
  }
}

export default function AgentRoster({ rows }: { rows: RosterRow[] }) {
  return (
    <section className="roster" aria-labelledby="roster-h">
      <div className="roster-head">
        <h2 id="roster-h">Agents</h2>
        <p>
          Everyone on the Dream website. Switch an agent&apos;s access on to send their invitation; they&apos;ll see
          their own listings and deals, and public facts for the rest. Switch it off to close their access.
        </p>
      </div>
      <ul className="roster-list" role="list">
        {rows.map((r) => (
          <RosterItem key={r.agentId} row={r} />
        ))}
      </ul>
    </section>
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
                  ? `Send ${first} an invitation to Dream OS?`
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
