import { createServiceClient } from "@/lib/supabase/service";

// Notify every active Director (app_user where role='admin' and active).
// Uses Resend directly via fetch — no SDK, so it stays a small dependency.
//
// Fails soft: if RESEND_API_KEY or NOTIFY_FROM isn't set, or no admins have
// emails, we log a warning and return without throwing. The caller doesn't
// want a threshold alert to nuke the request it was piggybacking on.
//
// Env:
//   RESEND_API_KEY   Resend project API key
//   NOTIFY_FROM      verified sender, e.g. "Dream OS <alerts@dreamproperties.app>"

export async function notifyAdmins(
  subject: string,
  bodyText: string,
): Promise<{ ok: boolean; recipients: number; error?: string }> {
  try {
    const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
    const from = (process.env.NOTIFY_FROM ?? "").trim();
    if (!apiKey || !from) {
      // eslint-disable-next-line no-console
      console.warn(
        "[notify] RESEND_API_KEY / NOTIFY_FROM not configured — alert dropped",
      );
      return { ok: false, recipients: 0, error: "notify not configured" };
    }

    const supabase = createServiceClient();
    const { data: admins } = await supabase
      .from("app_user")
      .select("email")
      .eq("role", "admin")
      .eq("active", true)
      .not("email", "is", null);

    const recipients = ((admins ?? []) as { email: string | null }[])
      .map((a) => (a.email ?? "").trim())
      .filter((e) => e.length > 0);

    if (recipients.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[notify] no active admins with email — alert dropped");
      return { ok: false, recipients: 0, error: "no recipients" };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text: bodyText,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // eslint-disable-next-line no-console
      console.warn(`[notify] Resend HTTP ${res.status}: ${text.slice(0, 300)}`);
      return {
        ok: false,
        recipients: recipients.length,
        error: `Resend HTTP ${res.status}`,
      };
    }
    return { ok: true, recipients: recipients.length };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[notify] threw: ${(e as Error).message}`);
    return { ok: false, recipients: 0, error: (e as Error).message };
  }
}
