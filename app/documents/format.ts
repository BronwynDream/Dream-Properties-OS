// Shared formatters for generated documents. Kept lean — every template
// pulls from here so currency and date presentation is consistent across
// the mandate, OTP, agreements, and any future artifact.

export function formatRand(amount: number): string {
  const rounded = Math.round(amount);
  const withCommas = new Intl.NumberFormat("en-ZA").format(rounded);
  return `R ${withCommas}`;
}

// Format YYYY-MM-DD as "2 August 2026" — long form is standard on SA legal
// documents. If the input is empty/undefined, returns an underscore blank so
// the printed template still shows a hand-writable line.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "___________________";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = d.toLocaleDateString("en-ZA", { month: "long" });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// Matrimonial regime code → human-readable label. Matches the enum defined
// in migration 0001_init.sql. Returns null for 'unknown' so the template
// hides the field entirely rather than printing "Not yet captured".
export function maritalRegimeLabel(
  regime: string | null,
): string | null {
  switch (regime) {
    case "single":
      return "Single / never married";
    case "married_in_community":
      return "Married in community of property";
    case "married_anc_no_accrual":
      return "Married ANC (no accrual)";
    case "married_anc_with_accrual":
      return "Married ANC (with accrual)";
    case "foreign_marriage":
      return "Foreign marriage";
    case "divorced":
      return "Divorced";
    case "widowed":
      return "Widowed";
    default:
      return null;
  }
}
