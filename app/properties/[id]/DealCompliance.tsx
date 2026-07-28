"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ensurePpraDisclosure,
  updatePpraAnswer,
  updatePpraHeader,
  upsertComplianceCert,
} from "./actions";
import type { PpraFormType, PpraQuestion } from "@/lib/ppraDisclosure";
import { questionsFor, summariseAnswers, readinessOf } from "@/lib/ppraDisclosure";

// Deal-compliance panel shown on the Property Record below the active
// deal band. Two sub-panels:
//   1. PPRA Section 67 disclosure — one row per canonical question,
//      three-way answer (yes / no / n/a), inline explanation. Answer
//      autosaves per row so agents don't lose progress.
//   2. Certificates of Compliance — electrical / entomologist / gas /
//      electric_fence. Issue date + expiry + issuer + notes.
//
// Deliberately colocated on the Property Record: this is the same
// document set an agent walks into a listing appointment carrying,
// so it lives with the property they're chasing.

type DisclosureRow = {
  id: string;
  question_key: string;
  answer: "yes" | "no" | "na" | "unanswered";
  explanation: string | null;
};

type Disclosure = {
  id: string;
  form_type: PpraFormType;
  signed_at: string | null;
  purchaser_ack_at: string | null;
  additional_info: string | null;
  rows: DisclosureRow[];
};

type CertRow = {
  code: "electrical" | "entomologist" | "gas" | "electric_fence";
  label: string;
  cert: {
    id: string;
    issued_date: string | null;
    expiry_date: string | null;
    issuer: string | null;
    notes: string | null;
  } | null;
};

type Props = {
  propertyId: string;
  transferId: string;
  formType: PpraFormType;
  disclosure: Disclosure | null;
  certs: CertRow[];
};

export default function DealCompliance({
  propertyId,
  transferId,
  formType,
  disclosure,
  certs,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const questions = questionsFor(formType);

  function refresh() {
    router.refresh();
  }

  function handleStart() {
    setErr(null);
    startTransition(async () => {
      const res = await ensurePpraDisclosure({ transferId, formType, propertyId });
      if (!res.ok) setErr(res.error);
      refresh();
    });
  }

  return (
    <section
      style={{
        marginTop: 28,
        padding: "20px 24px",
        background: "var(--paper-1, #F5F1E8)",
        border: "1px solid var(--line-soft, #E7E0D2)",
        borderRadius: "var(--radius-md, 8px)",
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-500, #6B6153)",
          }}
        >
          Deal compliance · this transfer
        </p>
        <h2
          style={{
            margin: "6px 0 0",
            fontFamily: "'Fraunces', serif",
            fontSize: 22,
            color: "var(--estuary, #132B84)",
            fontWeight: 500,
          }}
        >
          PPRA disclosure · Certificates of compliance
        </h2>
      </header>

      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            background: "#F7E3DF",
            color: "#7A2E28",
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}

      <PpraPanel
        disclosure={disclosure}
        questions={questions}
        formType={formType}
        onStart={handleStart}
        pending={pending}
        propertyId={propertyId}
      />

      <div style={{ height: 20 }} />

      <CertsPanel
        propertyId={propertyId}
        transferId={transferId}
        certs={certs}
      />
    </section>
  );
}

// -------- PPRA sub-panel --------

function PpraPanel({
  disclosure,
  questions,
  formType,
  onStart,
  pending,
  propertyId,
}: {
  disclosure: Disclosure | null;
  questions: PpraQuestion[];
  formType: PpraFormType;
  onStart: () => void;
  pending: boolean;
  propertyId: string;
}) {
  if (!disclosure) {
    return (
      <div
        style={{
          padding: "12px 16px",
          border: "1px dashed var(--line-strong, #D8CFBE)",
          borderRadius: 6,
          background: "var(--paper-0, #FBF9F4)",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-700, #423B31)" }}>
          <b>PPRA Section 67 · {formType === "house" ? "House" : "Plot"} disclosure</b> — not started.
          Regulatory: the seller must sign this before an OTP is concluded, and the purchaser must
          acknowledge receipt. Without it the sale is voidable.
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={pending}
          style={btnPrimary}
        >
          {pending ? "Starting…" : `Start ${formType} disclosure`}
        </button>
      </div>
    );
  }

  const summary = summariseAnswers(
    disclosure.rows.map((r) => ({
      question_key: r.question_key,
      answer: r.answer,
      explanation: r.explanation,
    })),
    formType,
  );
  const readiness = readinessOf(true, !!disclosure.signed_at, summary);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-700, #423B31)" }}>
          <b>PPRA Section 67 · {formType === "house" ? "House" : "Plot"} disclosure</b>
          <span style={{ marginLeft: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}>
            {summary.total} questions · {summary.unanswered} unanswered · {summary.concerning} concerning
            {summary.concerningMissingExplanation > 0 && ` · ${summary.concerningMissingExplanation} missing explanation`}
          </span>
        </p>
        <ReadinessPill readiness={readiness} />
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {questions.map((q) => {
          const row = disclosure.rows.find((r) => r.question_key === q.key);
          if (!row) return null;
          return <PpraRow key={q.key} question={q} row={row} disclosureId={disclosure.id} propertyId={propertyId} />;
        })}
      </ul>

      <HeaderFields disclosure={disclosure} propertyId={propertyId} />
    </div>
  );
}

function ReadinessPill({ readiness }: { readiness: "complete" | "in_progress" | "gaps" | "not_started" }) {
  const tone: Record<string, { bg: string; fg: string; label: string }> = {
    complete:    { bg: "var(--status-active-bg)",      fg: "var(--status-active-fg)",      label: "Complete" },
    in_progress: { bg: "var(--status-under-offer-bg)", fg: "var(--status-under-offer-fg)", label: "In progress" },
    gaps:        { bg: "var(--status-under-offer-bg)", fg: "var(--status-under-offer-fg)", label: "Gaps · unsigned" },
    not_started: { bg: "var(--status-draft-bg)",       fg: "var(--status-draft-fg)",       label: "Not started" },
  };
  const t = tone[readiness];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        background: t.bg,
        color: t.fg,
        borderRadius: 3,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {t.label}
    </span>
  );
}

function PpraRow({
  question,
  row,
  disclosureId,
  propertyId,
}: {
  question: PpraQuestion;
  row: DisclosureRow;
  disclosureId: string;
  propertyId: string;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState(row.answer);
  const [explanation, setExplanation] = useState(row.explanation ?? "");
  const [saving, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const needsExplanation = answer === question.concerningAnswer;

  function persist(nextAnswer: typeof answer, nextExplanation: string) {
    setSaved(false);
    startTransition(async () => {
      const res = await updatePpraAnswer({
        disclosureId,
        questionKey: question.key,
        answer: nextAnswer,
        explanation: nextExplanation,
        propertyId,
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--line-soft, #E7E0D2)",
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "var(--ink-900, #1F1B16)" }}>
          {question.label}
        </p>
        {needsExplanation && (
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            onBlur={() => persist(answer, explanation)}
            placeholder="Required — full explanation for this answer"
            rows={2}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: "inherit",
              border: "1px solid var(--line-strong, #D8CFBE)",
              borderRadius: 4,
              background: "var(--paper-0, #FBF9F4)",
              resize: "vertical",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {(["yes", "no", "na"] as const).map((v) => {
          const active = answer === v;
          const concerning = v === question.concerningAnswer;
          return (
            <button
              key={v}
              type="button"
              disabled={saving}
              onClick={() => {
                setAnswer(v);
                persist(v, explanation);
              }}
              style={{
                padding: "4px 12px",
                border: `1px solid ${active ? (concerning ? "var(--caution)" : "var(--estuary)") : "var(--line-strong, #D8CFBE)"}`,
                background: active
                  ? (concerning ? "var(--status-under-offer-bg)" : "var(--status-active-bg)")
                  : "var(--paper-0, #FBF9F4)",
                color: active
                  ? (concerning ? "var(--status-under-offer-fg)" : "var(--status-active-fg)")
                  : "var(--ink-700, #423B31)",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {v === "na" ? "N/A" : v}
            </button>
          );
        })}
        {saved && (
          <span style={{ fontSize: 10, color: "var(--positive)", marginLeft: 6, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            ✓
          </span>
        )}
      </div>
    </li>
  );
}

function HeaderFields({ disclosure, propertyId }: { disclosure: Disclosure; propertyId: string }) {
  const router = useRouter();
  const [signedAt, setSignedAt] = useState(disclosure.signed_at ?? "");
  const [ackAt, setAckAt] = useState(disclosure.purchaser_ack_at ?? "");
  const [info, setInfo] = useState(disclosure.additional_info ?? "");
  const [saving, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function persist() {
    startTransition(async () => {
      const res = await updatePpraHeader({
        disclosureId: disclosure.id,
        signed_at: signedAt,
        purchaser_ack_at: ackAt,
        additional_info: info,
        propertyId,
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--paper-0, #FBF9F4)", border: "1px solid var(--line-soft, #E7E0D2)", borderRadius: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <label style={labelStyle}>
          Signed by seller
          <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} onBlur={persist} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Purchaser acknowledged
          <input type="date" value={ackAt} onChange={(e) => setAckAt(e.target.value)} onBlur={persist} style={inputStyle} />
        </label>
      </div>
      <label style={{ ...labelStyle, marginTop: 12 }}>
        Additional information (free text)
        <textarea
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          onBlur={persist}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
      {saved && <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--positive)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>Saved</p>}
      {saving && <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--paper-mute)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>Saving…</p>}
    </div>
  );
}

// -------- Certificates sub-panel --------

function CertsPanel({
  propertyId,
  transferId,
  certs,
}: {
  propertyId: string;
  transferId: string;
  certs: CertRow[];
}) {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink-700, #423B31)" }}>
        <b>Certificates of compliance</b>
        <span style={{ marginLeft: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}>
          seller-supplied · required before transfer
        </span>
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {certs.map((c) => (
          <CertRow key={c.code} row={c} propertyId={propertyId} transferId={transferId} />
        ))}
      </div>
    </div>
  );
}

function CertRow({
  row,
  propertyId,
  transferId,
}: {
  row: CertRow;
  propertyId: string;
  transferId: string;
}) {
  const router = useRouter();
  const [issuedDate, setIssuedDate] = useState(row.cert?.issued_date ?? "");
  const [expiryDate, setExpiryDate] = useState(row.cert?.expiry_date ?? "");
  const [issuer, setIssuer] = useState(row.cert?.issuer ?? "");
  const [saving, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const status = deriveCertStatus(issuedDate, expiryDate);

  function persist() {
    setErr(null);
    startTransition(async () => {
      const res = await upsertComplianceCert({
        propertyId,
        transferId,
        code: row.code,
        issuedDate,
        expiryDate,
        issuer,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 180px) repeat(3, minmax(120px, 1fr)) auto",
        gap: 10,
        alignItems: "end",
        padding: "10px 14px",
        background: "var(--paper-0, #FBF9F4)",
        border: "1px solid var(--line-soft, #E7E0D2)",
        borderRadius: 4,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 14, color: "var(--estuary, #132B84)", fontWeight: 500 }}>
          {row.label}
        </span>
        <CertStatusPill status={status} />
      </div>
      <label style={labelStyle}>
        Issued
        <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} onBlur={persist} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Expiry
        <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} onBlur={persist} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Issuer / reg #
        <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} onBlur={persist} placeholder="e.g. Jones Electrical, ECB 12345" style={inputStyle} />
      </label>
      <div style={{ minWidth: 60, textAlign: "right", fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: err ? "var(--critical)" : saved ? "var(--positive)" : saving ? "var(--paper-mute)" : "transparent" }}>
        {err ?? (saved ? "Saved" : saving ? "Saving…" : " ")}
      </div>
    </div>
  );
}

function deriveCertStatus(issued: string, expiry: string): "outstanding" | "issued" | "expired" {
  if (!issued) return "outstanding";
  if (expiry) {
    const today = new Date().toISOString().slice(0, 10);
    if (expiry < today) return "expired";
  }
  return "issued";
}

function CertStatusPill({ status }: { status: "outstanding" | "issued" | "expired" }) {
  const tone: Record<string, { bg: string; fg: string; label: string }> = {
    outstanding: { bg: "var(--status-draft-bg)",      fg: "var(--status-draft-fg)",      label: "Outstanding" },
    issued:      { bg: "var(--status-active-bg)",     fg: "var(--status-active-fg)",     label: "Issued" },
    expired:     { bg: "var(--status-withdrawn-bg)",  fg: "var(--status-withdrawn-fg)",  label: "Expired" },
  };
  const t = tone[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: t.bg,
        color: t.fg,
        borderRadius: 3,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 9,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        alignSelf: "flex-start",
      }}
    >
      {t.label}
    </span>
  );
}

const btnPrimary: React.CSSProperties = {
  marginTop: 10,
  padding: "6px 14px",
  background: "var(--estuary, #132B84)",
  color: "var(--paper-0, #FBF9F4)",
  border: "none",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
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
};
