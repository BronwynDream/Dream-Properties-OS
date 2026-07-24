// Thin client for Resend's inbound-email API.
//
// Resend's inbound webhook only delivers METADATA — email id, from/to, subject,
// attachment list. Body text and attachment bytes require follow-up API calls.
// This file wraps those calls in a shape that matches the rest of the intake
// pipeline (which was originally shaped around Postmark's single-payload
// webhook).
//
// Docs:
//   webhook payload → https://resend.com/docs/dashboard/inbound/introduction
//   retrieve email  → https://resend.com/docs/api-reference/emails/retrieve-received-email
//   list atts       → https://resend.com/docs/api-reference/emails/list-received-email-attachments
//
// Env vars used:
//   RESEND_API_KEY          — same key already used by notifyAdmins for outbound
//   RESEND_WEBHOOK_SECRET   — signing secret from the inbound webhook config

const API_BASE = "https://api.resend.com";

export type ResendInboundAttachmentMeta = {
  id: string;
  filename: string;
  content_type: string;
  content_disposition: string | null;
  content_id: string | null;
  size: number;
  download_url: string;
  expires_at: string;
};

export type ResendReceivedEmail = {
  object: "email";
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string | null;
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  bcc: string[];
  cc: string[];
  reply_to: string[];
  received_for: string[];
  message_id: string;
  attachments: Array<{
    id: string;
    filename: string;
    content_type: string;
    content_disposition: string | null;
    content_id: string | null;
    size: number;
  }>;
};

function authHeaders(): Record<string, string> {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("RESEND_API_KEY not configured");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// GET /emails/receiving/{id} — fetches the full email (subject, body, headers).
// Attachments here are metadata only; use listReceivedAttachments for
// download URLs.
export async function retrieveReceivedEmail(
  emailId: string,
): Promise<ResendReceivedEmail> {
  const res = await fetch(`${API_BASE}/emails/receiving/${emailId}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `resend retrieveReceivedEmail ${emailId}: HTTP ${res.status} · ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as ResendReceivedEmail;
}

// GET /emails/receiving/{id}/attachments — returns metadata + signed CDN
// download_url per attachment. URLs expire (~24h) so fetch bytes promptly.
export async function listReceivedAttachments(
  emailId: string,
): Promise<ResendInboundAttachmentMeta[]> {
  const res = await fetch(
    `${API_BASE}/emails/receiving/${emailId}/attachments`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `resend listReceivedAttachments ${emailId}: HTTP ${res.status} · ${body.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    object: "list";
    has_more: boolean;
    data: ResendInboundAttachmentMeta[];
  };
  return json.data ?? [];
}

// Fetch attachment bytes from the signed CDN URL Resend returns. No auth
// header — the URL itself is a signed short-lived link.
export async function fetchAttachmentBytes(
  downloadUrl: string,
): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(
      `resend attachment fetch: HTTP ${res.status} for ${downloadUrl.slice(0, 80)}...`,
    );
  }
  return await res.arrayBuffer();
}

// One-shot: fetch email + attachments in parallel, resolve download URLs onto
// each attachment. Callers get a single object with everything they need to
// process the inbound.
export async function fetchInboundEmailComplete(emailId: string): Promise<{
  email: ResendReceivedEmail;
  attachments: ResendInboundAttachmentMeta[];
}> {
  const [email, attachments] = await Promise.all([
    retrieveReceivedEmail(emailId),
    listReceivedAttachments(emailId),
  ]);
  return { email, attachments };
}
