import Image from "next/image";
import type { AgencyIdentity } from "@/lib/agency";

// Wrapper for any generated printable document (mandate, OTP, addendum...).
// Every template renders inside a <DocumentPage agency={..}> and delegates
// header + footer to Letterhead / PageFooter. Templates stay focused on the
// clause body — the logo, agency identity block, and PPRA footer are
// inserted here so a rebrand / FFC change / new logo only touches one file.

export function DocumentPage({
  agency,
  showLetterhead = true,
  children,
}: {
  agency: AgencyIdentity;
  // Some statutory forms (e.g. PPRA Mandatory Disclosure) are fixed-format
  // and shouldn't carry the agency's own letterhead. Toggle it off there.
  showLetterhead?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <PrintStyles />
      <div className="doc-page">
        {showLetterhead && <Letterhead agency={agency} />}
        <div className="doc-body">{children}</div>
        <PageFooter agency={agency} />
      </div>
    </>
  );
}

function Letterhead({ agency }: { agency: AgencyIdentity }) {
  const contactLine = [agency.phone, agency.email].filter(Boolean).join("  ·  ");
  return (
    <header className="doc-letterhead">
      <div className="doc-letterhead-logo">
        <Image
          src={agency.logoPath}
          alt={agency.name}
          width={140}
          height={70}
          priority
          style={{ objectFit: "contain", height: "auto", width: "auto", maxHeight: 70 }}
        />
      </div>
      <div className="doc-letterhead-identity">
        <div className="doc-letterhead-name">{agency.name}</div>
        {agency.address && <div className="doc-letterhead-line">{agency.address}</div>}
        {contactLine && <div className="doc-letterhead-line">{contactLine}</div>}
        {agency.ffcNo && (
          <div className="doc-letterhead-ffc">
            PPRA FFC <span>#{agency.ffcNo}</span>
          </div>
        )}
      </div>
    </header>
  );
}

function PageFooter({ agency }: { agency: AgencyIdentity }) {
  return (
    <footer className="doc-footer">
      <div className="doc-footer-rule" />
      <div className="doc-footer-body">
        <span>{agency.ppraLine}</span>
        <span className="doc-footer-page" />
      </div>
    </footer>
  );
}

// Inline stylesheet so the whole printable surface lives in one file. Print
// media queries collapse browser chrome and give the page a proper A4 margin.
// `@page` size = A4 (SA default). `-webkit-print-color-adjust: exact` keeps
// hairline rules and gold accents visible when Bronwyn prints.
function PrintStyles() {
  return (
    <style>{`
      .doc-page {
        max-width: 780px;
        margin: 0 auto;
        padding: 32px 40px 24px;
        background: #FBF9F4;
        color: #0F2A63;
        font-family: Inter, -apple-system, sans-serif;
        font-size: 12pt;
        line-height: 1.55;
      }
      .doc-letterhead {
        display: grid;
        grid-template-columns: 160px 1fr;
        align-items: center;
        gap: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid #DED5C2;
        margin-bottom: 24px;
      }
      .doc-letterhead-logo {
        display: flex;
        align-items: center;
        justify-content: flex-start;
      }
      .doc-letterhead-identity {
        text-align: right;
      }
      .doc-letterhead-name {
        font-family: Inter, -apple-system, sans-serif;
        font-weight: 700;
        font-size: 16pt;
        letter-spacing: -0.01em;
        color: #0F2A63;
        margin-bottom: 4px;
      }
      .doc-letterhead-line {
        font-size: 9.5pt;
        color: #4A566E;
        line-height: 1.4;
      }
      .doc-letterhead-ffc {
        margin-top: 4px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 8.5pt;
        letter-spacing: 0.05em;
        color: #6B7A8C;
      }
      .doc-letterhead-ffc span {
        color: #0F2A63;
        font-weight: 600;
      }
      .doc-body {
        min-height: 60vh;
        padding: 8px 0 24px;
      }
      .doc-footer {
        margin-top: 32px;
      }
      .doc-footer-rule {
        height: 1px;
        background: #DED5C2;
        margin-bottom: 8px;
      }
      .doc-footer-body {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        font-size: 8pt;
        color: #6B7A8C;
        letter-spacing: 0.01em;
      }
      @media print {
        @page { size: A4; margin: 18mm 16mm 20mm; }
        html, body { background: #ffffff !important; }
        .no-print { display: none !important; }
        .doc-page {
          max-width: none;
          margin: 0;
          padding: 0;
          background: #ffffff;
          font-size: 11pt;
        }
        .doc-letterhead {
          padding-bottom: 10mm;
          margin-bottom: 10mm;
        }
        .doc-body {
          min-height: 0;
        }
        .doc-footer {
          position: running(footer);
        }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  );
}
