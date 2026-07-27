"use client";

import { useState, useTransition } from "react";
import { saveMandateExpiryWindows } from "./actions";

export default function MandateExpiryWindowsField({
  current,
  defaultValue,
}: {
  current: number[];
  defaultValue: number[];
}) {
  const [value, setValue] = useState(current.join(", "));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function submit(formData: FormData) {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await saveMandateExpiryWindows(formData);
      if (!res.ok) setErr(res.error);
      else setMsg("Saved.");
    });
  }

  return (
    <form
      action={submit}
      style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}
    >
      <label
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--paper-mute, #6a7692)",
        }}
        htmlFor="windows"
      >
        Expiry warning thresholds (days)
      </label>
      <input
        id="windows"
        name="windows"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={defaultValue.join(", ")}
        disabled={pending}
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 14,
          padding: "8px 10px",
          borderRadius: 3,
          border: "1px solid var(--hairline, #e2e8f5)",
          background: pending ? "var(--paper-bg, #f5f1e8)" : "#fff",
        }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "var(--paper-mute, #6a7692)", lineHeight: 1.5 }}>
        Comma-separated positive integers. Each creates a watchlist bucket.
        Example: <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>14, 30, 60</code>{" "}
        gives three buckets — expiring in 14 days, 15–30 days, 31–60 days.
        Default: <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{defaultValue.join(", ")}</code>.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "8px 16px",
            borderRadius: 3,
            border: "1px solid var(--estuary, #132B84)",
            background: pending ? "var(--paper-bg, #f5f1e8)" : "var(--estuary, #132B84)",
            color: pending ? "var(--paper-mute, #6a7692)" : "#fff",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span
            style={{
              fontSize: 12,
              color: "var(--green, #1F7A4D)",
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            {msg}
          </span>
        )}
        {err && (
          <span
            style={{
              fontSize: 12,
              color: "var(--amber, #D17E22)",
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            {err}
          </span>
        )}
      </div>
    </form>
  );
}
