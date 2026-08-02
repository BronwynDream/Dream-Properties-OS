"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

// Small popover on the Property Record's actions row. Clicking "Prepare
// mandate" reveals a two-choice picker (Sole / Joint) then navigates to
// /properties/[id]/documents/mandate/new?type=sole|joint. All other mandate
// terms (expiry, asking price, commission) are captured on that page next
// to a live preview — no separate modal for them, so the agent can see the
// document take shape as they type.

export default function PrepareMandateButton({
  propertyId,
  listingId,
  hasCurrentMandate,
}: {
  propertyId: string;
  listingId: string | null;
  hasCurrentMandate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside-to-close so the popover doesn't linger after the agent
  // starts a different action.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function go(type: "sole" | "joint") {
    setOpen(false);
    // Include listingId when we have one — the render page can otherwise fall
    // back to looking one up, but passing it makes the URL self-documenting.
    const params = new URLSearchParams({ type });
    if (listingId) params.set("listing", listingId);
    router.push(`/properties/${propertyId}/documents/mandate/new?${params.toString()}`);
  }

  const label = hasCurrentMandate ? "New mandate…" : "Prepare mandate…";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="ghost-dark"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: "8px 12px", fontSize: 13 }}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 220,
            background: "var(--paper)",
            border: "1px solid var(--paper-line)",
            borderRadius: 8,
            boxShadow: "0 6px 22px rgba(15, 42, 99, 0.12)",
            padding: 6,
            zIndex: 20,
          }}
        >
          <MenuButton
            onClick={() => go("sole")}
            title="Sole mandate"
            hint="Dream is the only agency marketing this property."
          />
          <MenuButton
            onClick={() => go("joint")}
            title="Joint mandate"
            hint="Marketed with a co-mandated agency (e.g. Pam Golding)."
          />
        </div>
      )}
    </div>
  );
}

function MenuButton({
  onClick,
  title,
  hint,
}: {
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 6,
        border: "none",
        background: "transparent",
        fontFamily: "inherit",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(19, 43, 132, 0.05)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--estuary)" }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--paper-mute)", marginTop: 2 }}>{hint}</div>
    </button>
  );
}
