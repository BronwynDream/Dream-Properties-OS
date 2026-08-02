"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AddSellerFields, {
  emptySeller,
  normaliseSeller,
  type SellerFormValue,
} from "@/app/properties/AddSellerFields";
import { createSellerWithProperty } from "./actions";

// Seller-first companion to NewPropertyForm. AddSellerFields is always open
// here (it's the primary form), plus an optional collapsible property block
// so the agent can capture both entities in one sitting. Convergence: same
// underlying rows are written regardless of which entry point was used.

export type SuburbOption = { id: string; name: string };

export default function NewSellerForm({ suburbs }: { suburbs: SuburbOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seller, setSeller] = useState<SellerFormValue>({
    ...emptySeller,
    partyType: "individual",
  });

  const [propertyOpen, setPropertyOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [suburbId, setSuburbId] = useState("");
  const [erf, setErf] = useState("");
  const [deed, setDeed] = useState("");
  const [coords, setCoords] = useState("");

  const [err, setErr] = useState<string | null>(null);

  function parseCoords(raw: string): { lat: number | null; lng: number | null; err: string | null } {
    const s = raw.trim();
    if (s === "") return { lat: null, lng: null, err: null };
    const parts = s.split(/[\s,\/]+/).filter(Boolean);
    if (parts.length !== 2) return { lat: null, lng: null, err: "Enter 'lat, lng' (e.g. -34.0777, 23.0619)" };
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null, err: "Both values must be numeric" };
    if (lat < -34.2 || lat > -33.65 || lng < 22.3 || lng > 23.6) {
      return { lat: null, lng: null, err: `Coords outside Knysna (${lat.toFixed(3)}, ${lng.toFixed(3)}) — copy from an existing listing or Mapbox` };
    }
    return { lat, lng, err: null };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const normalised = normaliseSeller(seller);
    if (!normalised) {
      setErr(seller.partyType === "individual" ? "Seller legal name is required." : "Registered entity name is required.");
      return;
    }
    const sellerPayload = {
      party_type: normalised.partyType,
      full_name: normalised.fullName || null,
      id_number: normalised.idNumber || null,
      passport_no: normalised.passportNo || null,
      matrimonial_regime: normalised.matrimonialRegime,
      entity_name: normalised.entityName || null,
      registration_no: normalised.registrationNo || null,
      email: normalised.email || null,
      phone: normalised.phone || null,
    };

    // Property block is optional — if opened but empty, treat as skipped.
    let propertyPayload: {
      primary_address: string;
      suburb_id?: string | null;
      erf_number?: string | null;
      title_deed_no?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null = null;
    if (propertyOpen && address.trim().length >= 3) {
      const { lat, lng, err: coordsErr } = parseCoords(coords);
      if (coordsErr) {
        setErr(coordsErr);
        return;
      }
      propertyPayload = {
        primary_address: address.trim(),
        suburb_id: suburbId || null,
        erf_number: erf.trim() || null,
        title_deed_no: deed.trim() || null,
        latitude: lat,
        longitude: lng,
      };
    }

    startTransition(async () => {
      const res = await createSellerWithProperty({
        seller: sellerPayload,
        property: propertyPayload,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      // Land on the Property Record when a property was created — that's
      // where the agent will click "Prepare mandate" next. Otherwise land
      // on the Seller Record so they can see what was captured.
      if (res.propertyId) {
        router.push(`/properties/${res.propertyId}`);
      } else {
        router.push(`/contacts/${res.partyId}`);
      }
    });
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <div style={{ marginBottom: 16 }}>
        <p style={eyebrowStyle}>New seller</p>
        <h3 style={titleStyle}>Capture the owner, then attach a property.</h3>
      </div>

      <AddSellerFields
        value={seller}
        onChange={setSeller}
        open={true}
        onOpenChange={() => {}}
        disabled={pending}
      />

      <div style={{ marginTop: 20 }}>
        {!propertyOpen ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              className="ghost-dark"
              onClick={() => setPropertyOpen(true)}
              disabled={pending}
              style={{ padding: "8px 12px", fontSize: 13 }}
            >
              + Attach a property
            </button>
            <span style={{ color: "#6b78a0", fontSize: 12 }}>
              Optional — you can add it later from the seller record.
            </span>
          </div>
        ) : (
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Property</p>
                <h4 style={panelTitleStyle}>Attach a property to this seller</h4>
              </div>
              <button
                type="button"
                onClick={() => setPropertyOpen(false)}
                disabled={pending}
                style={{
                  background: "none",
                  border: "none",
                  color: "#7a86a8",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                Skip property
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                gap: 10,
                alignItems: "end",
              }}
            >
              <label style={{ display: "block" }}>
                <span style={fieldLabel}>Address *</span>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 6 Bowden Park, Leisure Isle, Knysna"
                  disabled={pending}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={fieldLabel}>Suburb</span>
                <select
                  value={suburbId}
                  onChange={(e) => setSuburbId(e.target.value)}
                  disabled={pending}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {suburbs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span style={fieldLabel}>Erf</span>
                <input
                  type="text"
                  value={erf}
                  onChange={(e) => setErf(e.target.value)}
                  placeholder="1444"
                  disabled={pending}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={fieldLabel}>Title deed</span>
                <input
                  type="text"
                  value={deed}
                  onChange={(e) => setDeed(e.target.value)}
                  placeholder="T16806/2025"
                  disabled={pending}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "block", gridColumn: "1 / -1" }}>
                <span style={fieldLabel}>
                  Coordinates{" "}
                  <span style={{ textTransform: "none", letterSpacing: 0, color: "#7a86a8" }}>
                    — optional. Paste &quot;lat, lng&quot; (Knysna is roughly -34.05, 23.05).
                  </span>
                </span>
                <input
                  type="text"
                  value={coords}
                  onChange={(e) => setCoords(e.target.value)}
                  placeholder="-34.0777, 23.0619"
                  disabled={pending}
                  style={{ ...inputStyle, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
        <button
          type="submit"
          className="cta"
          disabled={pending}
          style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}
        >
          {pending ? "Creating…" : "Create seller"}
        </button>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => router.push("/contacts")}
          disabled={pending}
          style={{ padding: "9px 12px", fontSize: 13 }}
        >
          Cancel
        </button>
      </div>

      {err && (
        <p className="error" style={{ marginTop: 12, marginBottom: 0 }}>
          {err}
        </p>
      )}
    </form>
  );
}

const formStyle: React.CSSProperties = {
  background: "var(--white)",
  border: "1px solid #d7deef",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
};

const panelStyle: React.CSSProperties = {
  background: "#fbfcfe",
  border: "1px solid #eef1f8",
  borderRadius: 10,
  padding: 14,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--gold)",
  margin: 0,
};

const titleStyle: React.CSSProperties = {
  fontFamily: "Inter, -apple-system, sans-serif",
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.025em",
  color: "var(--estuary)",
  margin: "4px 0 0",
};

const panelTitleStyle: React.CSSProperties = {
  fontFamily: "Inter, -apple-system, sans-serif",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--estuary)",
  margin: "2px 0 0",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6b78a0",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d7deef",
  borderRadius: 7,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#fbfcfe",
};
