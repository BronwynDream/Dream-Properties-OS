import Link from "next/link";
import MaskedId from "./MaskedId";

export default function ContactRow({
  id,
  partyType,
  displayName,
  entityName,
  idNumber,
  email,
  phone,
  roles,
}: {
  id: string;
  partyType: string;
  displayName: string;
  entityName: string | null;
  idNumber: string | null;
  email: string | null;
  phone: string | null;
  roles: { side: string; year: string | null }[];
}) {
  // Timeline summary: "Seller 2024, Buyer 2026, Seller 2018". Deduplicate
  // consecutive same-side same-year entries.
  const timelineLabel = (() => {
    if (roles.length === 0) return "No transfers yet";
    const sorted = [...roles].sort((a, b) => (a.year ?? "").localeCompare(b.year ?? ""));
    return sorted
      .map((r) => `${r.side === "purchaser" ? "Buyer" : r.side === "seller" ? "Seller" : "Other"}${r.year ? ` ${r.year}` : ""}`)
      .join(", ");
  })();

  return (
    <Link href={`/contacts/${id}`} className="contact-row" prefetch={false}>
      <div className="contact-row-name">
        <span style={{ fontWeight: 600 }}>{displayName}</span>
        {entityName && entityName !== displayName && (
          <span style={{ color: "var(--paper-mute)", marginLeft: 8, fontSize: 12 }}>
            · {entityName}
          </span>
        )}
        <span style={{ color: "var(--paper-mute)", marginLeft: 8, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {partyType.replace("_", " ")}
        </span>
      </div>
      <div className="contact-row-meta">
        {idNumber && <MaskedId value={idNumber} />}
        {email && <span title={email}>{email}</span>}
        {phone && <span>{phone}</span>}
      </div>
      <div className="contact-row-roles">{timelineLabel}</div>
    </Link>
  );
}
