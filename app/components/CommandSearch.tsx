"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/app/api/search/route";

// ⌘K search (plan 019 Arc B2). One box over everything: properties, deals,
// people, prepared and filed documents, market listings, erven on the
// municipal roll, estates. Keyboard-first — ⌘K / Ctrl+K or "/" opens it,
// ↑ ↓ move, Enter opens, Esc closes — and every result is a link, so a
// mouse works too.

const GROUPS: { kind: SearchHit["kind"]; label: string }[] = [
  { kind: "property", label: "Properties" },
  { kind: "deal", label: "Deals" },
  { kind: "person", label: "People" },
  { kind: "draft", label: "Prepared documents" },
  { kind: "document", label: "Filed documents" },
  { kind: "market", label: "Market listings" },
  { kind: "erf", label: "Erven on the municipal roll" },
  { kind: "estate", label: "Estates" },
];

export default function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // Global shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Debounced fetch; a newer keystroke cancels the older request.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setErr(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const json = await res.json();
        setHits(json.hits ?? []);
        setErr(json.error ?? null);
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr("Search is unavailable right now.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // Grouped, in a fixed order; one flat index for the keyboard.
  const grouped = useMemo(() => {
    const out: { label: string; items: (SearchHit & { idx: number })[] }[] = [];
    let idx = 0;
    for (const g of GROUPS) {
      const items = hits.filter((h) => h.kind === g.kind).map((h) => ({ ...h, idx: idx++ }));
      if (items.length) out.push({ label: g.label, items });
    }
    return out;
  }, [hits]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
  }, []);

  const go = useCallback((h: SearchHit | undefined) => {
    if (!h?.href) return;
    close();
    if (/^https?:\/\//.test(h.href)) window.open(h.href, "_blank", "noopener");
    else router.push(h.href);
  }, [close, router]);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(flat[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const term = q.trim();

  return (
    <>
      <button type="button" className="topbar-search" onClick={() => setOpen(true)} aria-label="Search everything">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3.5 3.5" strokeLinecap="round" />
        </svg>
        <span className="topbar-search-text">Search</span>
        <kbd className="topbar-search-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      {open && (
        <div className="cmdk-backdrop" onMouseDown={close}>
          <div
            className="cmdk"
            role="dialog"
            aria-modal="true"
            aria-label="Search everything"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="cmdk-input-row">
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3.5 3.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                className="cmdk-input"
                placeholder="Address, erf number, name, phone, P24 ref…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="cmdk-list"
                aria-activedescendant={flat[active] ? `cmdk-${flat[active].kind}-${flat[active].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <span className="cmdk-spin" aria-label="Searching" />}
              <kbd className="cmdk-esc" onClick={close}>Esc</kbd>
            </div>

            <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
              {term.length < 2 && (
                <div className="cmdk-empty">
                  <p>Search the whole OS.</p>
                  <p className="cmdk-hint">Try <b>1764</b> · <b>13 campbell</b> · <b>sofianos</b> · <b>082 555 1234</b> · <b>occupational rent</b></p>
                </div>
              )}
              {term.length >= 2 && !loading && flat.length === 0 && (
                <div className="cmdk-empty">
                  <p>{err ? err : <>Nothing matches “{term}”.</>}</p>
                  {!err && <p className="cmdk-hint">Erf numbers match exactly; names and addresses forgive a typo.</p>}
                </div>
              )}
              {grouped.map((g) => (
                <div key={g.label} className="cmdk-group" role="group" aria-label={g.label}>
                  <div className="cmdk-group-label">{g.label}</div>
                  {g.items.map((h) => (
                    <a
                      key={`${h.kind}-${h.id}`}
                      id={`cmdk-${h.kind}-${h.id}`}
                      data-idx={h.idx}
                      role="option"
                      aria-selected={h.idx === active}
                      className={h.idx === active ? "cmdk-item is-active" : "cmdk-item"}
                      href={h.href ?? undefined}
                      onMouseMove={() => setActive(h.idx)}
                      onClick={(e) => { e.preventDefault(); go(h); }}
                    >
                      <span className={`cmdk-kind cmdk-kind-${h.kind}`} aria-hidden />
                      <span className="cmdk-item-text">
                        <span className="cmdk-item-title">{h.title}</span>
                        {h.subtitle && <span className="cmdk-item-sub">{h.subtitle}</span>}
                      </span>
                      {!h.href && <span className="cmdk-item-note">not filed on a property</span>}
                      {h.href && /^https?:/.test(h.href) && <span className="cmdk-item-note">opens portal ↗</span>}
                    </a>
                  ))}
                </div>
              ))}
            </div>

            <div className="cmdk-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>Enter</kbd> open</span>
              <span><kbd>Esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
