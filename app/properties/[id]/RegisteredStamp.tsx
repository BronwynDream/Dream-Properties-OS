// A rubber-ink "REGISTERED" stamp overlay for the Property Record hero.
// Different from the existing `RegistryStamp` in PropertyHero.tsx (which is
// a metadata card showing Erf / SG / Deed no.) — this one is a decorative-
// but-informational SVG that reads as a stamp actually applied by a clerk.
//
// Design rationale:
//   Cadastral / deeds-registry aesthetic is the project's chosen direction
//   (see `dream-design-language` memory). A rotated, semi-transparent ink
//   stamp is the single most identifiable artifact of that world — every
//   real title deed, every mandate PDF, every rates certificate carries
//   one. The OS gains a fingerprint that no SaaS dashboard could copy.
//
//   Colour: deep aubergine (#3D2645) is off the four brand accents on
//   purpose. Stamps are meant to feel like a different medium — a clerk's
//   ink pad — laid over the paper. Restricting the aubergine to this ONE
//   element (and never a border, chip, or text elsewhere) keeps that
//   signal clean.
//
//   Multiply blend + 72% opacity mimic ink absorbed into fibrous paper.
//   Slight -3.4° rotation and stroke-based text (not perfect font
//   rendering) are what make it read as "stamped" rather than "designed".
//
// Variants for now: REGISTERED. Mandate-held / in-conveyancing variants
// can be added by extending the primary/org/dateLabel switch.

type Variant = "registered" | "mandate_held" | "in_conveyancing";

const COPY: Record<Variant, { primary: string; org: string; dateLabel?: string }> = {
  registered: {
    primary: "REGISTERED",
    org: "CAPE TOWN DEEDS OFFICE",
  },
  mandate_held: {
    primary: "MANDATE HELD",
    org: "DREAM KNYSNA PROPERTIES",
    dateLabel: "EXP",
  },
  in_conveyancing: {
    primary: "IN CONVEYANCING",
    org: "DREAM KNYSNA PROPERTIES",
  },
};

export default function RegisteredStamp({
  variant,
  date,
  secondary,
}: {
  variant: Variant;
  date: string;
  secondary?: string;
}) {
  const copy = COPY[variant];
  const dateLine = [copy.dateLabel, date, secondary].filter(Boolean).join(" · ");

  return (
    <div className={`registered-stamp registered-stamp-${variant}`} aria-hidden>
      <svg
        viewBox="0 0 260 108"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Roughened edges — soft turbulence displaces the outline just
              enough to break its geometric perfection. Without this the
              rectangle looks CAD-clean, i.e. not a stamp. */}
          <filter id="stamp-roughen">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves="2"
              seed="7"
            />
            <feDisplacementMap in="SourceGraphic" scale="1.6" />
          </filter>
        </defs>

        <g filter="url(#stamp-roughen)" fill="currentColor">
          {/* Double-line border (real muni stamps often have a thin outer
              rule + a thicker inner one). */}
          <rect
            x="4" y="4" width="252" height="100"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
          />
          <rect
            x="10" y="10" width="240" height="88"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
          />

          {/* Primary word — big, spaced. */}
          <text
            x="130" y="44"
            textAnchor="middle"
            fontFamily="'JetBrains Mono', ui-monospace, monospace"
            fontSize="22"
            fontWeight="700"
            letterSpacing="5"
          >
            {copy.primary}
          </text>

          {/* Divider */}
          <line x1="36" y1="56" x2="224" y2="56" stroke="currentColor" strokeWidth="0.9" />

          {/* Org */}
          <text
            x="130" y="74"
            textAnchor="middle"
            fontFamily="'JetBrains Mono', ui-monospace, monospace"
            fontSize="9"
            letterSpacing="2.4"
          >
            {copy.org}
          </text>

          {/* Date row */}
          <text
            x="130" y="94"
            textAnchor="middle"
            fontFamily="'JetBrains Mono', ui-monospace, monospace"
            fontSize="11"
            fontWeight="600"
            letterSpacing="2"
          >
            {dateLine}
          </text>
        </g>
      </svg>
    </div>
  );
}
