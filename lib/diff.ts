// Compute the "what would this batch add to the linked property" summary
// used by the batch review screen. Same shape flows through server → client.

export type FieldDiff = {
  label: string;
  existing: string | null;
  proposed: string | null;
  kind: "adds" | "same" | "conflict" | "empty";
};

export type FileDiff = {
  name: string;
  kind: "new" | "duplicate";
};

export type TransferSummary = {
  id: string;
  name: string;
  status: string | null;
  transferDate: string | null;
  registeredDate: string | null;
  price: number | null;
  agreementDate: string | null;
};

export type PropertyDiff = {
  propertyId: string;
  propertyLabel: string;
  fields: FieldDiff[];
  files: {
    new: FileDiff[];
    duplicate: FileDiff[];
  };
  existingTransfers: TransferSummary[];
  wouldCreateNewTransfer: boolean;
  proposedTransfer: {
    price: string | null;
    date: string | null;
    parties: string[];
  };
  counts: {
    adds: number;
    conflicts: number;
    filled: number;
  };
};

function classify(existing: string | null, proposed: string | null): FieldDiff["kind"] {
  const e = existing?.trim();
  const p = proposed?.trim();
  if (!e && !p) return "empty";
  if (!e && p) return "adds";
  if (e && !p) return "same";
  if (e && p && e.toLowerCase() === p.toLowerCase()) return "same";
  return "conflict";
}

export function fieldDiff(
  label: string,
  existing: string | null,
  proposed: string | null,
): FieldDiff {
  return { label, existing, proposed, kind: classify(existing, proposed) };
}

// Trigram-ish normalisation for file-name compare (lowercase, collapse
// whitespace + underscores + hyphens, strip a trailing "(N)" copy marker).
export function normaliseFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\(\d+\)$/g, "")
    .replace(/[\s_\-]+/g, " ")
    .trim();
}
