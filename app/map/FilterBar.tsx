"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceKey } from "./MapView";
import type { Light } from "@/lib/feeds/registry";
import { SOURCE_META } from "./sources";
import {
  type Filters,
  type MapListing,
  type OurState,
  type TypeKey,
  type FeatureKey,
  DEFAULT_FILTERS,
  PRICE_STEPS,
  STATE_LABEL,
  TYPE_LABEL,
  TYPE_ORDER,
  FEATURE_LABEL,
  areaSuggestions,
  shortPrice,
} from "./listing";

// The search bar across the top of the map (2026-10-17 redesign).
// Airbnb / Zillow pattern: a horizontal row of pill buttons, each opening a
// small panel; the map and the list update as you choose. Area first, then
// price, beds & baths, type, the rest under "More", and which listings to
// show at the end.

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  listings: MapListing[];
  counts: { ours: number; bySource: Partial<Record<SourceKey, number>> };
  sourceHealth?: Partial<Record<SourceKey, Light>>;
  featuresKnown: boolean;
};

type PanelId = "price" | "rooms" | "type" | "more" | "show" | null;

export default function FilterBar({ filters, setFilters, listings, counts, sourceHealth, featuresKnown }: Props) {
  const [open, setOpen] = useState<PanelId>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Close the open panel on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const toggle = (id: Exclude<PanelId, null>) => setOpen((o) => (o === id ? null : id));

  const priceLabel =
    filters.priceMin == null && filters.priceMax == null
      ? "Price"
      : filters.priceMin != null && filters.priceMax != null
        ? `${shortPrice(filters.priceMin)} – ${shortPrice(filters.priceMax)}`
        : filters.priceMin != null
          ? `From ${shortPrice(filters.priceMin)}`
          : `Up to ${shortPrice(filters.priceMax)}`;
  const roomsLabel =
    filters.bedsMin == null && filters.bathsMin == null
      ? "Beds & baths"
      : [filters.bedsMin != null ? `${filters.bedsMin}+ bed` : null, filters.bathsMin != null ? `${filters.bathsMin}+ bath` : null]
          .filter(Boolean)
          .join(" · ");
  const typeLabel =
    filters.types.length === 0 ? "Type" : filters.types.length === 1 ? TYPE_LABEL[filters.types[0]] : `${filters.types.length} types`;
  const moreLabel = filters.features.length ? `More · ${filters.features.length}` : "More";
  const showLabel = filters.showOurs && filters.showMarket ? "All listings" : filters.showOurs ? "Our listings" : filters.showMarket ? "Other agencies" : "Nothing shown";
  const dirty = JSON.stringify({ ...filters, query: filters.query.trim() }) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="mx-bar" ref={barRef}>
      <AreaSearch filters={filters} set={set} listings={listings} />

      <div className="mx-bar-pills">
        <Pill label={priceLabel} on={filters.priceMin != null || filters.priceMax != null} open={open === "price"} onClick={() => toggle("price")}>
          <PricePanel filters={filters} set={set} listings={listings} />
        </Pill>

        <Pill label={roomsLabel} on={filters.bedsMin != null || filters.bathsMin != null} open={open === "rooms"} onClick={() => toggle("rooms")}>
          <div className="mx-panel-body">
            <Stepper label="Bedrooms" value={filters.bedsMin} onChange={(v) => set({ bedsMin: v })} />
            <Stepper label="Bathrooms" value={filters.bathsMin} onChange={(v) => set({ bathsMin: v })} />
            <p className="mx-note">Counts come from the portal listing; our own records don&apos;t carry rooms yet.</p>
          </div>
        </Pill>

        <Pill label={typeLabel} on={filters.types.length > 0} open={open === "type"} onClick={() => toggle("type")}>
          <div className="mx-panel-body">
            {TYPE_ORDER.map((t) => (
              <Check
                key={t}
                label={TYPE_LABEL[t]}
                count={listings.filter((l) => l.type === t).length}
                checked={filters.types.includes(t)}
                onChange={(on) => set({ types: on ? [...filters.types, t] : filters.types.filter((x) => x !== t) })}
              />
            ))}
          </div>
        </Pill>

        <Pill label={moreLabel} on={filters.features.length > 0} open={open === "more"} onClick={() => toggle("more")}>
          <div className="mx-panel-body">
            {(["garden", "pool", "garage", "pets"] as FeatureKey[]).map((f) => (
              <Check
                key={f}
                label={FEATURE_LABEL[f]}
                count={listings.filter((l) => l.features.includes(f)).length}
                checked={filters.features.includes(f)}
                disabled={!featuresKnown}
                onChange={(on) => set({ features: on ? [...filters.features, f] : filters.features.filter((x) => x !== f) })}
              />
            ))}
            {!featuresKnown && (
              <p className="mx-note">Garden, pool and garage are read from each Property24 page. They appear here once the listing facts update has run.</p>
            )}
          </div>
        </Pill>

        <span className="mx-bar-rule" aria-hidden />

        <Pill label={showLabel} on={!(filters.showOurs && filters.showMarket)} open={open === "show"} onClick={() => toggle("show")} align="right">
          <div className="mx-panel-body">
            <p className="mx-panel-eyebrow">Our listings</p>
            <Check label="Dream Knysna" count={counts.ours} checked={filters.showOurs} onChange={(on) => set({ showOurs: on })} swatch="ours" />
            <div className="mx-sub">
              {(["exclusive", "joint", "open", "none", "under_offer", "sold"] as OurState[]).map((st) => (
                <Check
                  key={st}
                  label={STATE_LABEL[st]}
                  checked={filters.ourStates.includes(st)}
                  disabled={!filters.showOurs}
                  onChange={(on) => set({ ourStates: on ? [...filters.ourStates, st] : filters.ourStates.filter((x) => x !== st) })}
                  small
                />
              ))}
            </div>
            <p className="mx-panel-eyebrow">Other agencies</p>
            <Check label="Show other agencies' listings" checked={filters.showMarket} onChange={(on) => set({ showMarket: on })} swatch="market" />
            <div className="mx-sub">
              {(["property24", "private_property", "dream_website"] as SourceKey[]).map((s) => (
                <Check
                  key={s}
                  label={SOURCE_META[s].label}
                  count={counts.bySource[s] ?? 0}
                  checked={filters.sources.includes(s)}
                  disabled={!filters.showMarket}
                  health={sourceHealth?.[s]}
                  onChange={(on) => set({ sources: on ? [...filters.sources, s] : filters.sources.filter((x) => x !== s) })}
                  small
                />
              ))}
            </div>
          </div>
        </Pill>

        {dirty && (
          <button type="button" className="mx-reset" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Pill({
  label,
  on,
  open,
  onClick,
  children,
  align = "left",
}: {
  label: string;
  on: boolean;
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className="mx-pill-wrap">
      <button type="button" className={`mx-pill${on ? " on" : ""}${open ? " open" : ""}`} aria-expanded={open} onClick={onClick}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className={`mx-panel${align === "right" ? " right" : ""}`}>{children}</div>}
    </div>
  );
}

function Check({
  label,
  count,
  checked,
  onChange,
  disabled,
  swatch,
  health,
  small,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  swatch?: "ours" | "market";
  health?: Light;
  small?: boolean;
}) {
  return (
    <label className={`mx-check${disabled ? " disabled" : ""}${small ? " small" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {swatch && <span className={`mx-swatch ${swatch}`} aria-hidden />}
      <span className="mx-check-label">{label}</span>
      {health && health !== "grey" && (
        <span className={`mx-health ${health}`} title={health === "green" ? "Feed up to date" : health === "amber" ? "Feed late" : "Feed failed"} />
      )}
      {count != null && <span className="mx-count">{count}</span>}
    </label>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const opts: (number | null)[] = [null, 1, 2, 3, 4, 5];
  return (
    <div className="mx-stepper">
      <span className="mx-stepper-label">{label}</span>
      <div className="mx-seg" role="group" aria-label={label}>
        {opts.map((o) => (
          <button key={String(o)} type="button" className={value === o ? "on" : ""} onClick={() => onChange(o)}>
            {o == null ? "Any" : `${o}+`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price: a small bar chart of where the listings sit, then min / max.
// ---------------------------------------------------------------------------

function PricePanel({ filters, set, listings }: { filters: Filters; set: (p: Partial<Filters>) => void; listings: MapListing[] }) {
  const bins = useMemo(() => {
    // Log-spaced bins from R500k to R30m: Knysna prices span two orders of magnitude.
    const lo = Math.log(400_000);
    const hi = Math.log(35_000_000);
    const n = 28;
    const counts = new Array(n).fill(0);
    for (const l of listings) {
      if (l.price == null) continue;
      const i = Math.floor(((Math.log(Math.max(l.price, 400_001)) - lo) / (hi - lo)) * n);
      counts[Math.max(0, Math.min(n - 1, i))]++;
    }
    const max = Math.max(1, ...counts);
    return counts.map((c, i) => ({
      c,
      h: c / max,
      from: Math.exp(lo + ((hi - lo) * i) / n),
      to: Math.exp(lo + ((hi - lo) * (i + 1)) / n),
    }));
  }, [listings]);

  const inRange = (from: number, to: number) =>
    (filters.priceMin == null || to >= filters.priceMin) && (filters.priceMax == null || from <= filters.priceMax);

  return (
    <div className="mx-panel-body mx-price">
      <div className={`mx-hist${filters.priceMin == null && filters.priceMax == null ? " all" : ""}`} aria-hidden>
        {bins.map((b, i) => (
          <span key={i} className={inRange(b.from, b.to) ? "in" : ""} style={{ height: `${Math.max(4, b.h * 100)}%` }} />
        ))}
      </div>
      <div className="mx-price-row">
        <label>
          <span>Min</span>
          <select value={filters.priceMin ?? ""} onChange={(e) => set({ priceMin: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No min</option>
            {PRICE_STEPS.filter((p) => filters.priceMax == null || p < filters.priceMax).map((p) => (
              <option key={p} value={p}>
                {shortPrice(p)}
              </option>
            ))}
          </select>
        </label>
        <span className="mx-dash">–</span>
        <label>
          <span>Max</span>
          <select value={filters.priceMax ?? ""} onChange={(e) => set({ priceMax: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No max</option>
            {PRICE_STEPS.filter((p) => filters.priceMin == null || p > filters.priceMin).map((p) => (
              <option key={p} value={p}>
                {shortPrice(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mx-note">Listings with no published price drop out when a range is set.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area: type a suburb, estate or street. Suggestions are the suburbs we
// actually have listings in, with counts; Enter keeps the typed words as a
// free-text filter.
// ---------------------------------------------------------------------------

function AreaSearch({ filters, set, listings }: { filters: Filters; set: (p: Partial<Filters>) => void; listings: MapListing[] }) {
  const [text, setText] = useState(filters.query);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => setText(filters.query), [filters.query]);

  const all = useMemo(() => areaSuggestions(listings), [listings]);
  const q = text.trim().toLowerCase();
  const sugg = all.filter((a) => !filters.areas.includes(a.name) && (!q || a.name.toLowerCase().includes(q))).slice(0, 8);

  const pick = (name: string) => {
    set({ areas: [...filters.areas, name], query: "" });
    setText("");
    setHi(0);
    setFocus(false); // close the suggestions; typing again reopens them
  };

  return (
    <div className="mx-search">
      <svg className="mx-search-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m10.5 10.5 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {filters.areas.map((a) => (
        <button key={a} type="button" className="mx-chip" onClick={() => set({ areas: filters.areas.filter((x) => x !== a) })} aria-label={`Remove ${a}`}>
          {a}
          <span aria-hidden>×</span>
        </button>
      ))}
      <input
        className="mx-search-input"
        value={text}
        placeholder={filters.areas.length ? "Add an area" : "Suburb, estate or street"}
        aria-label="Search by suburb, estate or street"
        onChange={(e) => {
          setText(e.target.value);
          setFocus(true);
          setHi(0);
          if (!e.target.value.trim() && filters.query) set({ query: "" });
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, sugg.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (sugg[hi] && q && sugg[hi].name.toLowerCase().startsWith(q)) pick(sugg[hi].name);
            else set({ query: text });
          } else if (e.key === "Backspace" && !text && filters.areas.length) {
            set({ areas: filters.areas.slice(0, -1) });
          } else if (e.key === "Escape") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {focus && sugg.length > 0 && (
        <ul className="mx-suggest" role="listbox">
          {sugg.map((s, i) => (
            <li key={s.name} role="option" aria-selected={i === hi}>
              <button type="button" className={i === hi ? "hi" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s.name)} onMouseEnter={() => setHi(i)}>
                <span>{s.name}</span>
                <span className="mx-count">{s.count}</span>
              </button>
            </li>
          ))}
          {q && (
            <li>
              <button type="button" className="mx-suggest-free" onMouseDown={(e) => e.preventDefault()} onClick={() => set({ query: text })}>
                Search for “{text.trim()}” in addresses
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export type { TypeKey };
