"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SearchInput() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      router.replace(`/contacts?${next.toString()}`);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search name, email, phone, ID…"
      autoFocus
      style={{
        width: "100%",
        padding: "12px 16px",
        fontSize: 14,
        fontFamily: "Inter, sans-serif",
        border: "1px solid var(--paper-line)",
        borderRadius: 6,
        background: "var(--paper)",
        color: "var(--estuary)",
        outline: "none",
      }}
    />
  );
}
