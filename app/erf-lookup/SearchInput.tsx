"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect } from "react";

export default function SearchInput({
  initialQ,
  initialSuburb,
  suburbs,
}: {
  initialQ: string;
  initialSuburb: string;
  suburbs: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [suburb, setSuburb] = useState(initialSuburb);
  const [pending, startTransition] = useTransition();

  // Keep local state aligned when the URL changes (e.g. browser back).
  useEffect(() => {
    setQ(initialQ);
    setSuburb(initialSuburb);
  }, [initialQ, initialSuburb]);

  function commit(nextQ: string, nextSuburb: string) {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (nextQ.trim().length > 0) p.set("q", nextQ.trim());
    else p.delete("q");
    if (nextSuburb.length > 0) p.set("suburb", nextSuburb);
    else p.delete("suburb");
    const qs = p.toString();
    startTransition(() => {
      router.replace(qs ? `/erf-lookup?${qs}` : "/erf-lookup");
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    commit(q, suburb);
  }

  function onSuburbChange(next: string) {
    setSuburb(next);
    commit(q, next);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="1453   or   15 eagles way   or   bowden park"
          disabled={pending}
          style={{
            flex: "1 1 320px",
            minWidth: 240,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 15,
            padding: "10px 12px",
            borderRadius: 3,
            border: "1px solid var(--hairline, #e2e8f5)",
            background: pending ? "var(--paper-bg, #f5f1e8)" : "#fff",
          }}
          autoFocus
        />
        <select
          value={suburb}
          onChange={(e) => onSuburbChange(e.target.value)}
          disabled={pending}
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 13,
            padding: "10px 12px",
            borderRadius: 3,
            border: "1px solid var(--hairline, #e2e8f5)",
            background: pending ? "var(--paper-bg, #f5f1e8)" : "#fff",
            minWidth: 180,
          }}
        >
          <option value="">All suburbs</option>
          {suburbs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "10px 20px",
            borderRadius: 3,
            border: "1px solid var(--estuary, #132B84)",
            background: pending ? "var(--paper-bg, #f5f1e8)" : "var(--estuary, #132B84)",
            color: pending ? "var(--paper-mute, #6a7692)" : "#fff",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {pending ? "Searching…" : "Search"}
        </button>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "var(--paper-mute, #6a7692)",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          letterSpacing: "0.02em",
        }}
      >
        ERF numbers repeat across Knysna suburbs — narrow with the suburb
        dropdown if you know it.
      </p>
    </form>
  );
}
