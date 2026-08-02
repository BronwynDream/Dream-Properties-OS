import type { AgencyIdentity } from "@/lib/agency";
import { formatRand, formatDate } from "../format";

// Sole / Joint mandate template — one component, `type` switches the clause
// that names the mandate flavour. Structure follows Bronwyn's Business
// Mandate template (Dream Properties — Business Mandate.docx) adapted for a
// residential / land sale. Every mergeable value is a prop; the render page
// pulls property + party + agency and hands them in.
//
// When Bronwyn ships a real property-mandate .docx template, we adjust the
// clause language here in-place; the merge fields and the letterhead frame
// stay the same. Do NOT embed the logo here — DocumentPage inserts the
// letterhead via Letterhead.tsx from a single source of truth.

export type MandateSoleProps = {
  type: "sole" | "joint";
  agency: AgencyIdentity;
  jointAgencyName: string | null;
  seller: {
    displayName: string;
    idOrRegistration: string | null;
    maritalRegimeLabel: string | null;
    addressLine: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  property: {
    primaryAddress: string;
    erfNumber: string | null;
    titleDeed: string | null;
    extentSqm: number | null;
  };
  terms: {
    askingPrice: number | null;
    commissionPct: number;
    commissionInclVat: boolean;
    signedDate: string; // ISO date
    expiryDate: string; // ISO date
  };
};

export default function MandateSole({
  type,
  agency,
  jointAgencyName,
  seller,
  property,
  terms,
}: MandateSoleProps) {
  const title = type === "sole" ? "SOLE MANDATE" : "JOINT MANDATE";

  const propertyDesc = [
    property.primaryAddress,
    property.erfNumber ? `Erf ${property.erfNumber}` : null,
    property.titleDeed ? `Deed ${property.titleDeed}` : null,
    property.extentSqm ? `${formatExtent(property.extentSqm)} extent` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const askingLine =
    terms.askingPrice != null
      ? `${formatRand(terms.askingPrice)} (${randInWords(terms.askingPrice)})`
      : "R _______________________ (___________________________________________)";

  const commissionLine = terms.commissionInclVat
    ? `${terms.commissionPct}% (inclusive of VAT at the prevailing rate)`
    : `${terms.commissionPct}% (exclusive of VAT — VAT at the prevailing rate will be added and paid by the Seller)`;

  const secondPartyClause =
    type === "sole"
      ? `${agency.name} an EXCLUSIVE MANDATE`
      : jointAgencyName
        ? `${agency.name} and ${jointAgencyName} a JOINT MANDATE`
        : `${agency.name} a JOINT MANDATE (co-mandated agency TBC)`;

  return (
    <article className="mandate">
      <h1 className="mandate-title">
        DREAM PROPERTIES — {title}
      </h1>

      <p className="mandate-preamble">Agreement entered into by and between</p>

      <SigneeBlock label={agency.name} sub={`registered estate agency, FFC ${agency.ffcNo ?? "____________"}`} />

      <p className="mandate-preamble">And</p>

      <SigneeBlock
        label={seller?.displayName ?? "_________________________________________________________________"}
        sub={
          seller
            ? [seller.idOrRegistration, seller.maritalRegimeLabel]
                .filter(Boolean)
                .join("  ·  ") || null
            : null
        }
        tail={
          seller?.addressLine
            ? `of ${seller.addressLine}`
            : "of ___________________________________________________________"
        }
      />

      <p className="mandate-hereafter">Hereafter referred to as &ldquo;the Seller&rdquo;.</p>

      <Section n={1} title="THE PROPERTY">
        <p>
          The Seller is the registered owner of, or otherwise entitled to sell, the immovable property known as{" "}
          <b>{propertyDesc}</b> (&ldquo;the Property&rdquo;), and wishes to sell the Property on the material terms and
          conditions set out below.
        </p>
      </Section>

      <Section n={2} title="MANDATE PERIOD">
        <p>
          From the date of signature hereof until 24h00 on <b>{formatDate(terms.expiryDate)}</b>, the Seller grants{" "}
          <b>{secondPartyClause}</b> to offer the Property for sale on the following terms, or such other terms as the
          Seller may approve in writing.
        </p>
      </Section>

      <Section n={3} title="CONDITIONS OF SALE">
        <p>
          3.1  The purchase price is <b>{askingLine}</b>, or such lower amount as the Seller may be prepared to accept.
        </p>
        <p>
          3.2  The purchase price is payable in cash against transfer of the Property to a purchaser, and a purchaser
          shall be required to pay a deposit and/or provide acceptable guarantees for payment of the purchase price upon
          conclusion of an agreement of sale.
        </p>
        <p>
          3.3  The sale shall be subject to the standard suspensive conditions ordinarily contained in {agency.name}&apos;s
          agreement of sale, unless the Seller and the purchaser expressly agree otherwise in writing.
        </p>
      </Section>

      <Section n={4} title="COMMISSION">
        <p>
          4.1  Upon the sale of the Property to a purchaser introduced by {agency.name}
          {type === "joint" && jointAgencyName ? ` or ${jointAgencyName}` : ""}, the Seller shall pay commission to{" "}
          {agency.name} equal to <b>{commissionLine}</b> of the purchase price in clause 3.1.
        </p>
        <p>
          4.2  The commission shall be deemed to have been earned upon the signing of an agreement of sale by the
          Seller and the purchaser, and upon the fulfilment of all suspensive conditions contained in the agreement,
          and shall be payable upon transfer of the Property.
        </p>
      </Section>

      <Section n={5} title={`OBLIGATIONS OF ${agency.name.toUpperCase()}`}>
        <p>{agency.name} hereby undertakes to:</p>
        <p>
          5.1  Treat all information given by the Seller to {agency.name} and its authorised representatives in the
          strictest confidence, and not to divulge any information to any potential purchaser who has not signed a
          confidentiality undertaking;
        </p>
        <p>
          5.2  Advertise the Property at {agency.name}&apos;s sole discretion and cost, in the manner it reasonably
          considers most likely to secure a suitable purchaser;
        </p>
        <p>
          5.3  Comply at all times with the Property Practitioners Act, 22 of 2019, and the Financial Intelligence
          Centre Act, 38 of 2001, in the marketing and conclusion of the sale.
        </p>
      </Section>

      <Section n={6} title="THE SELLER'S WARRANTY">
        <p>
          By signing this agreement the Seller warrants the accuracy of the information given by the Seller to{" "}
          {agency.name} for the purpose of disclosure to potential purchasers, and shall provide such further
          information as {agency.name} may reasonably request.
        </p>
      </Section>

      <SignatureBlock
        signedDate={terms.signedDate}
        sellerLabel={seller?.displayName ? `SELLER — ${seller.displayName}` : "SELLER"}
        agencyLabel={`${agency.name.toUpperCase()}${agency.principalName ? ` — ${agency.principalName}` : ""}`}
      />

      <PrintStyles />
    </article>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mandate-section">
      <h2 className="mandate-section-title">
        <span className="mandate-section-n">{n}.</span> {title}
      </h2>
      <div className="mandate-section-body">{children}</div>
    </section>
  );
}

function SigneeBlock({
  label,
  sub,
  tail,
}: {
  label: string;
  sub?: string | null;
  tail?: string;
}) {
  return (
    <div className="mandate-signee">
      <div className="mandate-signee-line">{label}</div>
      {sub && <div className="mandate-signee-sub">{sub}</div>}
      {tail && <div className="mandate-signee-tail">{tail}</div>}
    </div>
  );
}

function SignatureBlock({
  signedDate,
  sellerLabel,
  agencyLabel,
}: {
  signedDate: string;
  sellerLabel: string;
  agencyLabel: string;
}) {
  return (
    <div className="mandate-signatures">
      <p className="mandate-signature-lead">
        Signed at __________________________ on {formatDate(signedDate)}
      </p>
      <div className="mandate-signature-row">
        <SignatureSlot who={sellerLabel} />
        <SignatureSlot who="WITNESS" />
      </div>
      <div className="mandate-signature-row">
        <SignatureSlot who={agencyLabel} />
        <SignatureSlot who="WITNESS" />
      </div>
    </div>
  );
}

function SignatureSlot({ who }: { who: string }) {
  return (
    <div className="mandate-signature-slot">
      <div className="mandate-signature-rule" />
      <div className="mandate-signature-label">{who}</div>
    </div>
  );
}

function formatExtent(sqm: number): string {
  if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`;
  return `${Math.round(sqm)} m²`;
}

// Very rough Rand-in-words for the "R X (X in words)" clause. Handles millions
// + hundreds of thousands cleanly for typical Knysna prices. Not exhaustive —
// the printed template still shows a hand-writable blank if askingPrice is
// null, so this only fires when the agent has captured a numeric price.
function randInWords(price: number): string {
  const parts: string[] = [];
  const millions = Math.floor(price / 1_000_000);
  const rem1 = price % 1_000_000;
  const thousands = Math.floor(rem1 / 1_000);
  const rands = rem1 % 1_000;
  if (millions > 0) parts.push(`${numberInWords(millions)} million`);
  if (thousands > 0) parts.push(`${numberInWords(thousands)} thousand`);
  if (rands > 0) parts.push(numberInWords(rands));
  const base = parts.join(" ") || "zero";
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} rand`;
}

function numberInWords(n: number): string {
  const ones = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? tens[t] : `${tens[t]}-${ones[r]}`;
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = `${ones[h]} hundred`;
  return r === 0 ? head : `${head} and ${numberInWords(r)}`;
}

// Local styles for the mandate body. Print sizing is inherited from
// DocumentPage's @page rule; these styles cover typographic details specific
// to a legal contract layout — indentation, numbered sections, signature rows.
function PrintStyles() {
  return (
    <style>{`
      .mandate { font-size: 11pt; line-height: 1.55; }
      .mandate-title {
        font-family: Inter, -apple-system, sans-serif;
        font-size: 14pt;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-align: center;
        margin: 0 0 20px;
        color: #0F2A63;
      }
      .mandate-preamble {
        margin: 12px 0 6px;
        font-style: italic;
        color: #4A566E;
      }
      .mandate-signee { margin: 0 0 8px; padding: 8px 0 6px; border-bottom: 1px dashed #DED5C2; }
      .mandate-signee-line { font-weight: 600; color: #0F2A63; }
      .mandate-signee-sub { font-size: 9.5pt; color: #4A566E; margin-top: 2px; }
      .mandate-signee-tail { font-size: 10pt; color: #4A566E; margin-top: 2px; }
      .mandate-hereafter { margin: 4px 0 16px; font-style: italic; color: #4A566E; }
      .mandate-section { margin: 16px 0; page-break-inside: avoid; }
      .mandate-section-title {
        font-family: Inter, -apple-system, sans-serif;
        font-size: 11pt;
        font-weight: 700;
        letter-spacing: 0.02em;
        margin: 0 0 6px;
        color: #0F2A63;
      }
      .mandate-section-n {
        display: inline-block;
        width: 20px;
        color: #C8A032;
        font-family: "JetBrains Mono", ui-monospace, monospace;
      }
      .mandate-section-body p { margin: 6px 0; text-align: justify; }
      .mandate-signatures { margin-top: 32px; page-break-inside: avoid; }
      .mandate-signature-lead { margin-bottom: 20px; }
      .mandate-signature-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 30px;
        margin-bottom: 26px;
      }
      .mandate-signature-slot { display: flex; flex-direction: column; gap: 4px; }
      .mandate-signature-rule { height: 1px; background: #4A566E; margin-top: 24px; }
      .mandate-signature-label {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 8.5pt;
        letter-spacing: 0.08em;
        color: #4A566E;
      }
    `}</style>
  );
}
