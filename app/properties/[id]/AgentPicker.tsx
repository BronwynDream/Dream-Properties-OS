"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignListingAgent } from "./actions";

// Admin-only listing-agent assignment. Sits on the Property Record;
// non-admin sessions don't render it. Powers the per-agent /dashboard
// and /mandates scoping — before this exists, listing.agent_user_id
// stays null for every listing and agents see empty dashboards.
//
// If the property has no listing yet, the picker renders a hint so
// Bronwyn knows to create the listing first (via the take-on flow).

type Agent = { id: string; name: string; role: string };

export default function AgentPicker({
  listingId,
  currentAgentUserId,
  currentAgentName,
  agents,
}: {
  listingId: string | null;
  currentAgentUserId: string | null;
  currentAgentName: string | null;
  agents: Agent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(currentAgentUserId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function submit(next: string) {
    setSelected(next);
    setMsg(null);
    setErr(null);
    if (!listingId) return;
    startTransition(async () => {
      const res = await assignListingAgent(listingId, next || null);
      if (!res.ok) {
        setErr(res.error ?? "save failed");
        return;
      }
      setMsg("Saved.");
      router.refresh();
      setTimeout(() => setMsg(null), 2500);
    });
  }

  if (!listingId) {
    return (
      <div style={hintStyle}>
        <span style={labelStyle}>Assigned agent</span>
        <span style={{ ...bodyStyle, fontStyle: "italic" }}>
          No listing on this property yet — create one first.
        </span>
      </div>
    );
  }

  return (
    <div style={hintStyle}>
      <label htmlFor="agent-picker" style={labelStyle}>
        Assigned agent
      </label>
      <select
        id="agent-picker"
        value={selected}
        onChange={(e) => submit(e.target.value)}
        disabled={pending}
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: 3,
          border: "1px solid var(--hairline, #e2e8f5)",
          background: pending ? "var(--paper-bg, #f5f1e8)" : "#fff",
          minWidth: 180,
        }}
      >
        <option value="">— Unassigned —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.role === "admin" ? " (Director)" : ""}
          </option>
        ))}
      </select>
      {currentAgentName && !selected && (
        <span style={{ ...bodyStyle, color: "var(--paper-mute, #6a7692)" }}>
          Was {currentAgentName}
        </span>
      )}
      {msg && (
        <span style={{ ...bodyStyle, color: "var(--green, #1F7A4D)", fontWeight: 600 }}>
          {msg}
        </span>
      )}
      {err && (
        <span style={{ ...bodyStyle, color: "var(--amber, #D17E22)", fontWeight: 600 }}>
          {err}
        </span>
      )}
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};
const labelStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--paper-mute, #6a7692)",
};
const bodyStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
};
