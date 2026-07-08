import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { classifyBatchWithClient } from "@/lib/classify-batch";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
// Postmark can send 25 MB inbound payloads. Give the pipeline room to
// decode + upload sequentially without racing the platform timeout.
export const maxDuration = 300;

// POST /api/intake/email?token=<INTAKE_WEBHOOK_TOKEN>
//
// Postmark inbound webhook. Setup:
//   1. Postmark → Servers → your server → Message Streams → Inbound.
//   2. Set Webhook URL: https://dreamproperties.app/api/intake/email?token=<INTAKE_WEBHOOK_TOKEN>
//   3. Include raw email content: OFF (we only need parsed JSON + attachments).
//   4. Point intake@dreamproperties.app MX at Postmark's inbound host
//      (Postmark → Servers → InboundStream → Setup Instructions).
//   5. Env vars on Vercel:
//        INTAKE_WEBHOOK_TOKEN       — long random string, matches the ?token= above
//        SUPABASE_SERVICE_ROLE_KEY  — from Supabase → Settings → API (service_role)
//
// Auth: URL token, constant-time compared. Sender allow-list: the From address
// must match a row in app_user (case-insensitive). Anything else → 403.
//
// Idempotency: Postmark retries on 5xx. We dedupe by MessageID so a retry
// returns the existing batch instead of creating a duplicate.
//
// Subject-driven routing:
//   "Property: 6 Bowden Park"  → property intent
//   "Client:   John Smith"     → client   intent (creates/updates a party)
//   (no recognised prefix)     → property intent (backwards-compat default)
//
// Fuzzy match (pg_trgm via match_property_by_address / match_party_by_name):
//   Property: similarity >= 0.55 against primary_address → attach to existing.
//   Client:   similarity >= 0.60 against party.display_name → attach to existing.
//   No match → create new row.
// Weaker matches are ignored — Bronwyn can merge later in /dupes if needed.
//
// Pipeline: (property|party) row → ingest_batch (source='email',
// property_id OR party_id set) → email body saved as ingest_file → attachments
// decoded + uploaded → classifyBatch. Extraction is left for Bronwyn to trigger
// from /triage/[id], same as the drag-drop flow's default.

const MAX_ATTACHMENT_MB = 20;
const PROPERTY_MATCH_THRESHOLD = 0.55;
const PARTY_MATCH_THRESHOLD = 0.6;

type PostmarkAttachment = {
  Name?: string;
  Content?: string; // base64
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string;
};

type PostmarkInbound = {
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
  Attachments?: PostmarkAttachment[];
};

type Intent = "property" | "client";

export async function POST(request: Request) {
  // 1. URL token check.
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = process.env.INTAKE_WEBHOOK_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "INTAKE_WEBHOOK_TOKEN not configured" },
      { status: 500 },
    );
  }
  if (!constantTimeEq(token, expected)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  // 2. Parse Postmark JSON.
  let body: PostmarkInbound;
  try {
    body = (await request.json()) as PostmarkInbound;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fromEmail = (body.FromFull?.Email ?? body.From ?? "").trim().toLowerCase();
  const rawSubject = (body.Subject ?? "").trim();
  const textBody = (body.TextBody ?? "").trim();
  const messageId = (body.MessageID ?? "").trim() || null;
  const attachments = Array.isArray(body.Attachments) ? body.Attachments : [];

  if (!fromEmail) {
    return NextResponse.json({ error: "missing From address" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 3. Idempotency: same MessageID → return existing batch.
  if (messageId) {
    const { data: existing } = await supabase
      .from("ingest_batch")
      .select("id, property_id, party_id")
      .eq("postmark_message_id", messageId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        ok: true,
        dedupe: true,
        batchId: existing.id,
        propertyId: existing.property_id,
        partyId: existing.party_id,
        triageUrl: `/triage/${existing.id}`,
      });
    }
  }

  // 4. Sender allow-list: must be an app_user.
  const { data: appUser } = await supabase
    .from("app_user")
    .select("id, email")
    .ilike("email", fromEmail)
    .maybeSingle();
  if (!appUser?.id) {
    return NextResponse.json(
      { error: `sender ${fromEmail} not on the allow-list` },
      { status: 403 },
    );
  }

  // 5. Route on subject prefix.
  const { intent, value: subjectValue } = parseSubject(rawSubject);
  const label = (subjectValue.slice(0, 200) || "(untitled intake)").trim();

  const target =
    intent === "client"
      ? await resolveParty(supabase, subjectValue, label)
      : await resolveProperty(supabase, subjectValue, label);

  // 6. Create the batch — one of property_id / party_id is set.
  const batchInsert: Record<string, unknown> = {
    label: target.batchLabel,
    source: "email",
    created_by: appUser.id,
    sender_email: fromEmail,
    postmark_message_id: messageId,
  };
  if (intent === "property") batchInsert.property_id = target.id;
  else batchInsert.party_id = target.id;

  const { data: batch, error: bErr } = await supabase
    .from("ingest_batch")
    .insert(batchInsert)
    .select("id")
    .single();
  if (bErr || !batch) {
    return NextResponse.json(
      { error: bErr?.message ?? "could not create batch" },
      { status: 500 },
    );
  }

  const errors: string[] = [];

  // 7. Save the email body as its own file — often carries the address, CMA
  //    context, or notes that never make it into an attachment.
  if (textBody) {
    const header = `From: ${fromEmail}\nSubject: ${rawSubject}\n\n`;
    const bytes = Buffer.from(header + textBody, "utf8");
    const path = `${batch.id}/00-email-body.txt`;
    const { error: upErr } = await supabase.storage
      .from("staging")
      .upload(path, bytes, { contentType: "text/plain", upsert: true });
    if (upErr) {
      errors.push(`upload email body: ${upErr.message}`);
    } else {
      const { error: fErr } = await supabase.from("ingest_file").insert({
        batch_id: batch.id,
        original_filename: "email-body.txt",
        storage_bucket: "staging",
        storage_path: path,
        mime_type: "text/plain",
        byte_size: bytes.length,
        status: "uploaded",
      });
      if (fErr) errors.push(`file row email-body: ${fErr.message}`);
    }
  }

  // 8. Attachments: decode base64, upload to staging, insert ingest_file rows.
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const name = safeFilename(String(a?.Name ?? `attachment-${i + 1}`));
    const contentType = String(a?.ContentType ?? "application/octet-stream");
    const content = String(a?.Content ?? "");
    if (!content) continue;

    let bytes: Buffer;
    try {
      bytes = Buffer.from(content, "base64");
    } catch (e) {
      errors.push(`decode ${name}: ${(e as Error).message}`);
      continue;
    }
    if (bytes.length === 0) continue;
    if (bytes.length > MAX_ATTACHMENT_MB * 1024 * 1024) {
      errors.push(`${name} exceeds ${MAX_ATTACHMENT_MB} MB — skipped`);
      continue;
    }

    const prefix = String(i + 1).padStart(2, "0");
    const path = `${batch.id}/${prefix}-${name}`;
    const { error: upErr } = await supabase.storage
      .from("staging")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) {
      errors.push(`upload ${name}: ${upErr.message}`);
      continue;
    }
    const { error: fErr } = await supabase.from("ingest_file").insert({
      batch_id: batch.id,
      original_filename: name,
      storage_bucket: "staging",
      storage_path: path,
      mime_type: contentType,
      byte_size: bytes.length,
      status: "uploaded",
    });
    if (fErr) errors.push(`file row ${name}: ${fErr.message}`);
  }

  // 9. Classify — sets doc types, PII flags, batch tier, and renames a
  //    generic "(untitled intake)" batch off its best-named document when
  //    possible. Extraction is a review-time step, not run here.
  try {
    await classifyBatchWithClient(batch.id, supabase);
  } catch (e) {
    errors.push(`classify: ${(e as Error).message}`);
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    triageUrl: `/triage/${batch.id}`,
    intent,
    matched: target.matched,
    matchedName: target.matchedName,
    propertyId: intent === "property" ? target.id : null,
    partyId: intent === "client" ? target.id : null,
    attachmentCount: attachments.length,
    errors,
  });
}

// GET is convenient for a browser sanity check that the route is reachable.
// Never leaks state — just confirms the token model is wired.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = process.env.INTAKE_WEBHOOK_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "INTAKE_WEBHOOK_TOKEN not configured" },
      { status: 500 },
    );
  }
  if (!constantTimeEq(token, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ready: true });
}

// ----------------------------------------------------------------------------
// Subject parsing + resolvers
// ----------------------------------------------------------------------------

// "Property: 6 Bowden Park"  → { intent: 'property', value: '6 Bowden Park' }
// "Client:   John Smith"     → { intent: 'client',   value: 'John Smith'   }
// "Contact - Jane Doe"       → { intent: 'client',   value: 'Jane Doe'     }
// "6 Bowden Park mandate"    → { intent: 'property', value: full string    }
// Fw:/Re: prefixes are stripped before prefix detection so forwarded threads
// still route cleanly.
function parseSubject(raw: string): { intent: Intent; value: string } {
  let s = (raw ?? "").trim();
  // Strip forward / reply prefixes (Fwd, Fw, Re) at the front.
  s = s.replace(/^\s*(?:fwd?|re)\s*:\s*/gi, "").trim();

  const m = s.match(/^(property|client|contact)\s*[:—\-]\s*(.+)$/i);
  if (m) {
    const intent: Intent = /^prop/i.test(m[1]) ? "property" : "client";
    return { intent, value: m[2].trim() };
  }
  return { intent: "property", value: s };
}

type ResolveResult = {
  id: string;
  batchLabel: string;
  matched: boolean;
  matchedName: string | null;
};

async function resolveProperty(
  supabase: SupabaseClient,
  subjectValue: string,
  fallbackLabel: string,
): Promise<ResolveResult> {
  // Fuzzy match against existing addresses.
  const q = subjectValue.trim();
  if (q.length >= 3) {
    const { data: matches } = await supabase.rpc("match_property_by_address", {
      q,
      min_sim: PROPERTY_MATCH_THRESHOLD,
    });
    const best = (matches as Array<{ id: string; primary_address: string; sim: number }> | null)?.[0];
    if (best) {
      return {
        id: best.id,
        batchLabel: best.primary_address ?? fallbackLabel,
        matched: true,
        matchedName: best.primary_address ?? null,
      };
    }
  }

  // No match → create.
  const primary_address = q || "(untitled intake)";
  const { data: newProp, error } = await supabase
    .from("property")
    .insert({ primary_address })
    .select("id, primary_address")
    .single();
  if (error || !newProp) {
    throw new Error(`could not create property: ${error?.message ?? "no row"}`);
  }
  return {
    id: newProp.id,
    batchLabel: newProp.primary_address ?? fallbackLabel,
    matched: false,
    matchedName: null,
  };
}

async function resolveParty(
  supabase: SupabaseClient,
  subjectValue: string,
  fallbackLabel: string,
): Promise<ResolveResult> {
  const q = subjectValue.trim();
  if (q.length >= 3) {
    const { data: matches } = await supabase.rpc("match_party_by_name", {
      q,
      min_sim: PARTY_MATCH_THRESHOLD,
    });
    const best = (matches as Array<{ id: string; display_name: string; sim: number }> | null)?.[0];
    if (best) {
      return {
        id: best.id,
        batchLabel: `Client · ${best.display_name}`,
        matched: true,
        matchedName: best.display_name ?? null,
      };
    }
  }

  // No match → create. All name-only intakes default to individual; if the
  // party turns out to be juristic (trust / company / CC), Bronwyn edits at
  // review — party_type has an unknown state we never lean on for logic.
  const display_name = q || "(untitled client)";
  const { data: newParty, error } = await supabase
    .from("party")
    .insert({ party_type: "individual", display_name })
    .select("id, display_name")
    .single();
  if (error || !newParty) {
    throw new Error(`could not create party: ${error?.message ?? "no row"}`);
  }
  return {
    id: newParty.id,
    batchLabel: `Client · ${newParty.display_name ?? fallbackLabel}`,
    matched: false,
    matchedName: null,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function constantTimeEq(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeFilename(raw: string): string {
  const trimmed = (raw || "attachment").split("/").pop()!.split("\\").pop()!;
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9._\-\s]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "attachment";
}
