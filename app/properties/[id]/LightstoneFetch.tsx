"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type LightstoneProduct = {
  code: string;
  label: string;
  description: string;
};

// "Fetch from Lightstone" button → inline picker → POST /api/lightstone.
// Shows a checkbox per product from the adapter. On response, refreshes the
// Property Record so the new documents + coalesced fields appear.
export default function LightstoneFetch({
  propertyId,
  products,
}: {
  propertyId: string;
  products: LightstoneProduct[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(["title_deed", "deeds_search"]));
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<"stub" | "live" | null>(null);

  function toggle(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function submit() {
    if (checked.size === 0) {
      setErr("Pick at least one product.");
      return;
    }
    setErr(null);
    setMsg(null);
    setSource(null);
    setRunning(true);
    try {
      const res = await fetch("/api/lightstone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          productCodes: Array.from(checked),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setErr(json.error ?? "fetch failed");
        setRunning(false);
        return;
      }
      setSource(json.source ?? null);
      setMsg(
        `${json.created.length} document${json.created.length === 1 ? "" : "s"} added${
          json.errors && json.errors.length > 0
            ? ` · ${json.errors.length} error(s)`
            : ""
        }.`,
      );
      setRunning(false);
      router.refresh();
      // Close the picker after a short delay so the message is visible
      setTimeout(() => {
        setOpen(false);
        setMsg(null);
        setSource(null);
      }, 2600);
    } catch (e) {
      setErr((e as Error).message);
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ghost-dark"
        onClick={() => setOpen(true)}
        style={{ padding: "8px 14px", fontSize: 13 }}
      >
        Fetch from Lightstone
      </button>
    );
  }

  return (
    <div
      style={{
        background: "var(--white)",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
        maxWidth: 640,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
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
          Lightstone
        </p>
        <h3
          style={{
            fontFamily: "Inter, -apple-system, sans-serif",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--estuary)",
            margin: 0,
          }}
        >
          Pick the products to fetch onto this property
        </h3>
      </div>

      <ul
        style={{
          margin: "10px 0 14px",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {products.map((p) => {
          const isOn = checked.has(p.code);
          return (
            <li key={p.code}>
              <label
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: isOn ? "var(--navy)" : "#d7deef",
                  background: isOn ? "rgba(19,43,132,0.03)" : "#fff",
                  cursor: "pointer",
                  alignItems: "flex-start",
                }}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(p.code)}
                  disabled={running}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: "Inter, -apple-system, sans-serif",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--estuary)",
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {p.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#5b6885", marginTop: 2 }}>
                    {p.description}
                  </div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="cta"
          onClick={submit}
          disabled={running || checked.size === 0}
          style={{ padding: "9px 14px", fontSize: 13 }}
        >
          {running ? "Fetching…" : `Fetch ${checked.size} selected`}
        </button>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => {
            setOpen(false);
            setErr(null);
            setMsg(null);
          }}
          disabled={running}
          style={{ padding: "9px 12px", fontSize: 13 }}
        >
          Cancel
        </button>
      </div>

      {msg && (
        <p
          style={{
            marginTop: 10,
            marginBottom: 0,
            color: "var(--estuary)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {msg}
          {source === "stub" && (
            <span style={{ color: "#7A5814", fontWeight: 500 }}>
              {" "}(sample data — Lightstone not yet connected)
            </span>
          )}
        </p>
      )}
      {err && (
        <p className="error" style={{ marginTop: 10, marginBottom: 0 }}>
          {err}
        </p>
      )}
    </div>
  );
}
