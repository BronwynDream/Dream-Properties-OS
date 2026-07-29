"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createViewing,
  cancelViewing,
  addAttendee,
  updateAttendee,
  deleteAttendee,
  updateViewing,
} from "@/app/viewings/actions";
import {
  VIEWING_KIND_LABEL,
  VIEWING_KIND_STRIPE,
  formatViewingTime,
  type ViewingKind,
} from "@/lib/viewings";

// Viewings sub-panel on the Property Record. Two purposes:
//   1. Schedule a viewing (show house, private viewing, valuation visit)
//   2. Capture attendees from a past viewing — walk-in name / phone /
//      whether they were interested — for follow-up
//
// Sits alongside PPRA / Certs / Fixtures inside the Deal Compliance
// block so an agent walking into an appointment can see everything
// tied to this property in one panel.

export type ViewingItem = {
  id: string;
  kind: ViewingKind;
  status: "scheduled" | "completed" | "cancelled";
  scheduledAt: string;
  durationMinutes: number;
  agentName: string | null;
  attendees: AttendeeItem[];
};

export type AttendeeItem = {
  id: string;
  partyId: string | null;
  partyName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  followedUp: boolean;
  isInterested: boolean | null;
  notes: string | null;
};

type Props = {
  propertyId: string;
  listingId: string | null;
  transferId: string | null;
  agentUserId: string | null;
  viewings: ViewingItem[];
};

export default function Viewings({ propertyId, listingId, transferId, agentUserId, viewings }: Props) {
  const [showForm, setShowForm] = useState(false);
  const upcoming = viewings.filter((v) => v.status !== "cancelled" && new Date(v.scheduledAt) >= new Date());
  const past = viewings.filter((v) => v.status !== "cancelled" && new Date(v.scheduledAt) < new Date());

  return (
    <section style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-700, #423B31)" }}>
          <b>Viewings</b>
          <span style={{ marginLeft: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}>
            show houses · private viewings · valuation visits
          </span>
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <Link href="/viewings" style={btnGhost}>
            Weekly view →
          </Link>
          {!showForm && (
            <button type="button" onClick={() => setShowForm(true)} style={btnPrimary}>
              + Schedule
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <NewViewingForm
          propertyId={propertyId}
          listingId={listingId}
          transferId={transferId}
          defaultAgentUserId={agentUserId}
          onDone={() => setShowForm(false)}
        />
      )}

      {upcoming.length === 0 && past.length === 0 && !showForm && (
        <p style={{ margin: "8px 0", fontSize: 12, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
          No viewings scheduled yet.
        </p>
      )}

      {upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {upcoming.map((v) => (
            <ViewingRow key={v.id} v={v} propertyId={propertyId} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--paper-mute, #6a7692)", cursor: "pointer" }}>
            Past viewings · {past.length}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {past.map((v) => (
              <ViewingRow key={v.id} v={v} propertyId={propertyId} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// -------- single viewing (schedule row + attendees) --------

function ViewingRow({ v, propertyId }: { v: ViewingItem; propertyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addingAttendee, setAddingAttendee] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const stripe = VIEWING_KIND_STRIPE[v.kind];

  function cancel() {
    if (!confirm("Cancel this viewing?")) return;
    startTransition(async () => {
      await cancelViewing({ id: v.id, propertyId });
      router.refresh();
    });
  }

  function markCompleted() {
    setMarkingDone(true);
    startTransition(async () => {
      await updateViewing({ id: v.id, propertyId, status: "completed" });
      setMarkingDone(false);
      router.refresh();
    });
  }

  const isPast = new Date(v.scheduledAt) < new Date();
  const canMarkDone = isPast && v.status === "scheduled";

  return (
    <div
      style={{
        borderLeft: `3px solid ${stripe}`,
        background: "var(--paper-0, #FBF9F4)",
        padding: "8px 10px",
        borderRadius: "0 4px 4px 0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: "var(--estuary, #132B84)", fontWeight: 700 }}>
            {formatViewingTime(v.scheduledAt)}
          </span>
          <span style={{ marginLeft: 8, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {VIEWING_KIND_LABEL[v.kind]} · {v.durationMinutes}m
          </span>
          {v.agentName && (
            <span style={{ marginLeft: 8, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)" }}>
              {v.agentName}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {canMarkDone && (
            <button type="button" onClick={markCompleted} disabled={pending || markingDone} style={btnGhost}>
              {markingDone ? "…" : "Mark done"}
            </button>
          )}
          {v.status !== "cancelled" && (
            <button type="button" onClick={cancel} disabled={pending} style={btnDanger}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <p style={{ margin: "0 0 4px", fontSize: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Attendees · {v.attendees.length}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {v.attendees.map((a) => (
            <AttendeeRow key={a.id} attendee={a} propertyId={propertyId} />
          ))}
        </div>
        {addingAttendee ? (
          <NewAttendeeForm viewingId={v.id} propertyId={propertyId} onDone={() => setAddingAttendee(false)} />
        ) : (
          <button type="button" onClick={() => setAddingAttendee(true)} style={{ ...btnGhost, marginTop: 6 }}>
            + Attendee
          </button>
        )}
      </div>
    </div>
  );
}

function AttendeeRow({ attendee, propertyId }: { attendee: AttendeeItem; propertyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [followed, setFollowed] = useState(attendee.followedUp);
  const [interest, setInterest] = useState<boolean | null>(attendee.isInterested);
  const displayName = attendee.partyName ?? attendee.name ?? "—";

  function persistFollowed(next: boolean) {
    setFollowed(next);
    startTransition(async () => {
      await updateAttendee({ id: attendee.id, propertyId, followedUp: next });
      router.refresh();
    });
  }

  function persistInterest(next: boolean | null) {
    setInterest(next);
    startTransition(async () => {
      await updateAttendee({ id: attendee.id, propertyId, isInterested: next });
      router.refresh();
    });
  }

  function del() {
    if (!confirm(`Remove ${displayName}?`)) return;
    startTransition(async () => {
      await deleteAttendee({ id: attendee.id, propertyId });
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12, borderBottom: "1px solid var(--line-soft, #E7E0D2)" }}>
      <div>
        {attendee.partyId ? (
          <Link href={`/contacts/${attendee.partyId}`} style={{ color: "var(--estuary, #132B84)", fontWeight: 500 }}>
            {displayName}
          </Link>
        ) : (
          <span style={{ color: "var(--ink-700, #423B31)", fontWeight: 500 }}>{displayName}</span>
        )}
        {(attendee.phone || attendee.email) && (
          <div style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)" }}>
            {attendee.phone}{attendee.phone && attendee.email && " · "}{attendee.email}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        <button type="button" onClick={() => persistInterest(interest === true ? null : true)} disabled={pending} title="Interested" style={interest === true ? interestBtnOn : interestBtn}>★</button>
        <button type="button" onClick={() => persistInterest(interest === false ? null : false)} disabled={pending} title="Not interested" style={interest === false ? passBtnOn : interestBtn}>·</button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)", letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
        <input type="checkbox" checked={followed} onChange={(e) => persistFollowed(e.target.checked)} disabled={pending} />
        Followed up
      </label>
      <button type="button" onClick={del} disabled={pending} style={{ background: "none", border: "none", color: "var(--paper-mute, #6a7692)", cursor: "pointer", fontSize: 14, padding: 4, lineHeight: 1 }} title="Remove">×</button>
      <span />
    </div>
  );
}

// -------- forms --------

function NewViewingForm({
  propertyId,
  listingId,
  transferId,
  defaultAgentUserId,
  onDone,
}: {
  propertyId: string;
  listingId: string | null;
  transferId: string | null;
  defaultAgentUserId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ViewingKind>("show_house");
  // Default: next upcoming Sunday 14:00 (SA show-house rhythm) if kind
  // is show_house, else tomorrow 10:00.
  const defaultDateTime = (() => {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0);
    return d.toISOString().slice(0, 16);
  })();
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime);
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    startTransition(async () => {
      const res = await createViewing({
        propertyId,
        listingId,
        transferId,
        agentUserId: defaultAgentUserId,
        kind,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: duration,
        notes,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <div style={{ padding: 10, background: "var(--paper-1, #F5F1E8)", border: "1px dashed var(--line-strong, #D8CFBE)", borderRadius: 4, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <label style={labelStyle}>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as ViewingKind)} disabled={pending} style={inputStyle}>
            <option value="show_house">Show house</option>
            <option value="private_viewing">Private viewing</option>
            <option value="valuation_visit">Valuation visit</option>
          </select>
        </label>
        <label style={labelStyle}>
          When
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={pending} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Duration (min)
          <input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} disabled={pending} style={inputStyle} />
        </label>
      </div>
      <label style={{ ...labelStyle, marginTop: 8 }}>
        Notes
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Meet at the gate, key from Bronwyn, etc." disabled={pending} style={inputStyle} />
      </label>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" onClick={submit} disabled={pending} style={btnPrimary}>
          {pending ? "Scheduling…" : "Schedule"}
        </button>
        <button type="button" onClick={onDone} disabled={pending} style={btnGhost}>Cancel</button>
      </div>
      {err && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--critical, #9A3B34)" }}>{err}</p>}
    </div>
  );
}

function NewAttendeeForm({
  viewingId,
  propertyId,
  onDone,
}: {
  viewingId: string;
  propertyId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!name.trim()) {
      setErr("Name required");
      return;
    }
    startTransition(async () => {
      const res = await addAttendee({ viewingId, propertyId, name, phone, email });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setName(""); setPhone(""); setEmail("");
      onDone();
      router.refresh();
    });
  }

  return (
    <div style={{ padding: 8, marginTop: 6, background: "var(--paper-1, #F5F1E8)", border: "1px dashed var(--line-strong, #D8CFBE)", borderRadius: 4, display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: 6, alignItems: "center" }}>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" disabled={pending} style={inputStyle} autoFocus />
      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" disabled={pending} style={inputStyle} />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" disabled={pending} style={inputStyle} />
      <button type="button" onClick={submit} disabled={pending} style={btnPrimary}>{pending ? "…" : "Add"}</button>
      <button type="button" onClick={onDone} style={btnGhost}>×</button>
      {err && <p style={{ gridColumn: "1/-1", margin: 0, fontSize: 10, color: "var(--critical, #9A3B34)" }}>{err}</p>}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "5px 12px",
  background: "var(--estuary, #132B84)",
  color: "var(--paper-0, #FBF9F4)",
  border: "none",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  color: "var(--estuary, #132B84)",
  border: "1px solid var(--estuary, #132B84)",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

const btnDanger: React.CSSProperties = {
  ...btnGhost,
  color: "var(--critical, #9A3B34)",
  border: "1px solid var(--critical, #9A3B34)",
};

const interestBtn: React.CSSProperties = {
  padding: "1px 6px",
  background: "var(--paper-0, #FBF9F4)",
  color: "var(--paper-mute, #6a7692)",
  border: "1px solid var(--line-strong, #D8CFBE)",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 11,
};

const interestBtnOn: React.CSSProperties = {
  ...interestBtn,
  background: "var(--status-active-bg)",
  color: "var(--status-active-fg)",
  border: "1px solid var(--status-active-fg)",
};

const passBtnOn: React.CSSProperties = {
  ...interestBtn,
  background: "var(--status-withdrawn-bg)",
  color: "var(--status-withdrawn-fg)",
  border: "1px solid var(--status-withdrawn-fg)",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--paper-mute, #6a7692)",
};

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid var(--line-strong, #D8CFBE)",
  borderRadius: 3,
  fontFamily: "inherit",
  fontSize: 12,
  background: "var(--paper-0, #FBF9F4)",
  width: "100%",
};
