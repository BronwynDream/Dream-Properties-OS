import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { getSetting, SETTINGS_DEFAULTS } from "@/lib/settings";
import MandateExpiryWindowsField from "./MandateExpiryWindowsField";

export const dynamic = "force-dynamic";

// Admin-only OS settings surface. First (and currently only) section:
// mandate expiry cascade windows, which drive the /mandates watchlist.
// Structured so a future section (e.g. Portals, Inbox rules) just adds
// another <SettingsSection> block below without touching the router or
// the settings library.

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const mandateWindows = await getSetting("mandate.expiry_window_days");

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Settings</p>
          <h1>Operating configuration</h1>
          <p className="app-sub">
            Admin-only. Changes apply immediately across the OS on next page load.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <SettingsSection
            heading="Mandates"
            description={
              <>
                Watchlist thresholds used on the{" "}
                <Link href="/mandates" style={{ color: "var(--navy)", fontWeight: 600 }}>
                  Mandates
                </Link>{" "}
                page. Enter a comma-separated list of days-ahead-of-expiry.
                Each value creates a bucket on the watchlist.
              </>
            }
          >
            <MandateExpiryWindowsField
              current={mandateWindows}
              defaultValue={SETTINGS_DEFAULTS["mandate.expiry_window_days"]}
            />
          </SettingsSection>

          <SettingsSection
            heading="Municipal valuation rolls"
            description={
              <>
                Upload Knysna Muni PDFs — Full General Valuation Roll (5-yearly baseline)
                or Supplementary Rolls (deltas). Parsed and applied to{" "}
                <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>muni_valuation</code>
                {" "}so map / Erf Lookup / Property Record show current values.
              </>
            }
          >
            <Link
              href="/admin/valuation-rolls"
              style={{
                display: "inline-block",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                padding: "8px 16px",
                borderRadius: 3,
                border: "1px solid var(--estuary, #132B84)",
                background: "var(--estuary, #132B84)",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Open valuation-roll manager →
            </Link>
          </SettingsSection>
        </section>
      </main>
    </>
  );
}

function SettingsSection({
  heading,
  description,
  children,
}: {
  heading: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 8, paddingBottom: 32, borderBottom: "1px solid var(--hairline, #e2e8f5)" }}>
      <h2
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--estuary, #132B84)",
          margin: "24px 0 6px",
        }}
      >
        {heading}
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--paper-mute, #6a7692)", lineHeight: 1.5 }}>
        {description}
      </p>
      {children}
    </div>
  );
}
