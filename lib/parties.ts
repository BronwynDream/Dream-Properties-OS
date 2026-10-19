// Seller capture shared by the property take-on form and the Documents
// mandate flow (moved out of app/properties/actions.ts, 2026-10-19, so a
// non-async helper can be shared — "use server" files export async only).

export type SellerInput = {
  party_type: "individual" | "trust" | "company" | "close_corporation";
  full_name?: string | null;
  id_number?: string | null;
  passport_no?: string | null;
  matrimonial_regime?:
    | "single"
    | "married_in_community"
    | "married_anc_no_accrual"
    | "married_anc_with_accrual"
    | "foreign_marriage"
    | "divorced"
    | "widowed"
    | "unknown"
    | null;
  entity_name?: string | null;
  registration_no?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function buildPartyRow(s: SellerInput): Record<string, unknown> | null {
  const email = s.email?.trim() || null;
  const phone = s.phone?.trim() || null;

  if (s.party_type === "individual") {
    const fullName = (s.full_name ?? "").trim();
    if (!fullName) return null;
    // Naive split: last word = surname, everything before = first_names. SA
    // compound surnames (van der Merwe, etc) get miscategorised; agent can
    // edit on the Seller Record page. Good enough for pre-fill on a mandate.
    const parts = fullName.split(/\s+/);
    const surname = parts.length > 1 ? parts.slice(-1).join(" ") : null;
    const firstNames = parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;
    return {
      party_type: "individual",
      display_name: fullName,
      first_names: firstNames,
      surname,
      id_number: s.id_number?.trim() || null,
      passport_no: s.passport_no?.trim() || null,
      matrimonial_regime: s.matrimonial_regime ?? "unknown",
      email,
      phone,
    };
  }

  const entityName = (s.entity_name ?? "").trim();
  if (!entityName) return null;
  return {
    party_type: s.party_type,
    display_name: entityName,
    entity_name: entityName,
    registration_no: s.registration_no?.trim() || null,
    email,
    phone,
  };
}
