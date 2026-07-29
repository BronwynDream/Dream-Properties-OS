// Canonical inventory defaults sourced from Bronwyn's contract templates:
//   Fixtures — clause 14 of the Master Copy Dream Agreement of Sale 2026.
//              These items are part of the immovable property sale by
//              default; the buyer receives them at the same price.
//   Movables — Annexure A of Dream Properties Movables Agreement 2026.
//              A SEPARATE sale for furniture / appliances / soft
//              furnishings, carrying its own price + effective date.
//
// Both lists render as "start here" seeds when an agent opens the
// inventory panel on a transfer for the first time. Every row is
// editable — add / remove / toggle inclusion / annotate. The seeds
// simply mirror what Bronwyn hand-types into every deal.

export type InventoryCategory = "fixture" | "movables";

export type InventoryKind =
  | "lighting"
  | "cupboards_shelving"
  | "kitchen_appliance"
  | "appliance"
  | "kitchenware"
  | "fireplace"
  | "pool"
  | "garden"
  | "power"
  | "keys"
  | "furniture"
  | "soft_furnishing"
  | "artwork"
  | "personal"
  | "other";

export type InventorySeed = {
  kind: InventoryKind;
  description: string;
  is_included: boolean;
};

// Verbatim from clause 14 of the Master Sale template. Order matches
// the printed template so a signed copy reconciles line-for-line.
export const DEFAULT_FIXTURES: InventorySeed[] = [
  { kind: "lighting",            description: "Fixed light fittings",                                                     is_included: true },
  { kind: "cupboards_shelving",  description: "All fitted cupboards, shelving, curtain rails and rods",                    is_included: true },
  { kind: "kitchen_appliance",   description: "Oven, Hob & Extractor",                                                     is_included: true },
  { kind: "fireplace",           description: "Free standing fireplace",                                                   is_included: true },
  { kind: "pool",                description: "Pool cleaning equipment and pump",                                           is_included: true },
  { kind: "garden",              description: "Garden irrigation and related equipment, including all water tanks",        is_included: true },
  { kind: "power",               description: "Alternate power systems — invertor, batteries, solar panels",               is_included: true },
  { kind: "keys",                description: "Keys and remote controls for the property",                                  is_included: true },
];

// From Annexure A of the Movables Agreement. Inclusions and exclusions
// are captured in one list so the agent sees the whole picture and can
// flip any line as the deal is negotiated. Exclusions default to
// is_included=false (won't appear on the signed Annexure).
export const DEFAULT_MOVABLES: InventorySeed[] = [
  // Inclusions
  { kind: "furniture",        description: "All furniture: beds & mattresses, side tables, outdoor furniture, pool loungers, sofas, chairs, pedestals, dining table and chairs", is_included: true },
  { kind: "soft_furnishing",  description: "Soft furnishings: lamps, cushions, carpets, rugs, mirrors, towels, one set of bed linen (pillows, duvets, blankets) per bed",         is_included: true },
  { kind: "appliance",        description: "All appliances: toaster, kettle, microwave, fridge/freezer, iron, television, etc.",                                                  is_included: true },
  { kind: "kitchenware",      description: "All kitchen utensils: crockery, cutlery, glassware, serving dishes, pots & pans and general kitchen items",                          is_included: true },
  { kind: "garden",           description: "All outdoor equipment: garden implements, swimming pool cleaning equipment, water tanks, etc.",                                       is_included: true },
  { kind: "power",            description: "Alternate power systems — invertor and batteries",                                                                                    is_included: true },
  // Exclusions — kept in the list so the seller is prompted to declare them
  { kind: "personal",         description: "Personal items",                                                                                                                       is_included: false },
  { kind: "artwork",          description: "Artwork and artefacts",                                                                                                                is_included: false },
];

export function seedsFor(category: InventoryCategory): InventorySeed[] {
  return category === "fixture" ? DEFAULT_FIXTURES : DEFAULT_MOVABLES;
}

// Human labels for the kind enum — used in filters + row grouping.
export const KIND_LABEL: Record<InventoryKind, string> = {
  lighting:           "Lighting",
  cupboards_shelving: "Cupboards & shelving",
  kitchen_appliance:  "Kitchen appliance",
  appliance:          "Appliance",
  kitchenware:        "Kitchenware",
  fireplace:          "Fireplace",
  pool:               "Pool",
  garden:             "Garden & outdoor",
  power:              "Alt. power",
  keys:               "Keys & remotes",
  furniture:          "Furniture",
  soft_furnishing:    "Soft furnishing",
  artwork:            "Artwork",
  personal:           "Personal",
  other:              "Other",
};
