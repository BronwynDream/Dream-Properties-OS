import { NextResponse } from "next/server";
import { recordFeedRun } from "@/lib/feeds/run";
import { Webhook } from "svix";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { classifyBatchWithClient } from "@/lib/classify-batch";
import { deepClassifyBatch } from "@/lib/classify-deep";
import { extractBatchWithClient } from "@/lib/intake/extract-batch";
import { commitBatchWithClient } from "@/lib/intake/commit-batch";
import {
  batchIsFilingOnly,
  fileBatchAgainstPropertyWithClient,
} from "@/lib/intake/file-batch";
import {
  fetchInboundEmailComplete,
  fetchAttachmentBytes,
} from "@/lib/resend/inbound";

export const runtime = "nodejs";
// Resend's inbound flow: webhook (metadata) → fetch email + attachments via
// their API → download each attachment from a signed CDN URL. That's up to
// ~1 + 1 + N HTTP calls per email. 300s ceiling matches Vercel Hobby's max
// and gives room for a big multi-attachment intake.
export const maxDuration = 300;

// POST /api/intake/email
//
// Resend inbound webhook. Setup:
//   1. Resend → Domains → add dreamproperties.app, add DNS records
//      (DKIM TXT, SPF MX, SPF TXT, DMARC TXT, inbound MX).
//   2. Resend → Webhooks → create webhook for the inbound email event, URL:
//      https://dreamproperties.app/api/intake/email
//   3. Env vars on Vercel:
//        RESEND_API_KEY            — from Resend → API Keys (Full access)
//        RESEND_WEBHOOK_SECRET     — from Resend → Webhooks → this webhook
//        SUPABASE_SERVICE_ROLE_KEY — from Supabase → Settings → API
//
// Auth: svix signature verification on the incoming webhook. Sender allow-
// list: the From address must match a row in app_user (case-insensitive).
// Anything else → 403.
//
// Idempotency: Resend retries webhooks on 5xx. We dedupe by email_id
// (stored as "resend:<uuid>" in ingest_batch.provider_message_id) so a retry
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
//
// Pipeline: (property|party) row → ingest_batch (source='email',
// property_id OR party_id set) → email body saved as ingest_file → attachments
// fetched from Resend CDN + uploaded → classifyBatch. Extraction is left for
// Bronwyn to trigger from /triage/[id].

const MAX_ATTACHMENT_MB = 20;
const PROPERTY_MATCH_THRESHOLD = 0.55;
const PARTY_MATCH_THRESHOLD = 0.6;

// Resend's inbound webhook envelope. Metadata only — body + attachment bytes
// are fetched via their API.
type ResendInboundEvent = {
  type: string;
  created_at?: string;
  data: {
    email_id: string;
    created_at?: string;
    from: string;
    to?: string[];
    subject?: string | null;
    message_id?: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
    }>;
  };
};

type Intent = "property" | "client";

export async function POST(request: Request) {
  return recordFeedRun("intake_email", request, () => handlePost(request));
}

async function handlePost(request: Request) {
  // 1. Svix signature verification.
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "missing svix signature headers" },
      { status: 401 },
    );
  }

  const rawBody = await request.text();
  let event: ResendInboundEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendInboundEvent;
  } catch (e) {
    return NextResponse.json(
      { error: `signature verification failed: ${(e as Error).message}` },
      { status: 401 },
    );
  }

  // 2. Only handle inbound-email events. Resend may send other event types on
  //    the same webhook URL if you configure multiple event types — ignore
  //    them cleanly with a 200 so Resend doesn't retry.
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ error: "missing email_id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const providerMessageId = `resend:${emailId}`;

  // 3. Idempotency: same email_id → return existing batch.
  const { data: existing } = await supabase
    .from("ingest_batch")
    .select("id, property_id, party_id")
    .eq("provider_message_id", providerMessageId)
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

  // 4. Fetch the full email + attachments metadata from Resend. This is where
  //    the body text, real from-address, and download URLs actually come from.
  let email;
  let attachmentMetas;
  try {
    const complete = await fetchInboundEmailComplete(emailId);
    email = complete.email;
    attachmentMetas = complete.attachments;
  } catch (e) {
    // 502 so Resend retries the webhook — transient API blip is worth a redo.
    return NextResponse.json(
      { error: `resend fetch failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const fromEmail = normaliseEmail(email.from);
  if (!fromEmail) {
    return NextResponse.json({ error: "missing From address" }, { status: 400 });
  }

  // 5. Sender allow-list: must be an app_user.
  const { data: appUser } = await supabase
    .from("app_user")
    .select("id, email, role, active")
    // Exact, case-insensitive: escape LIKE wildcards so a From header with
    // % or _ can't match someone else (security review 2026-10-21).
    .ilike("email", fromEmail.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (!appUser?.id) {
    return NextResponse.json(
      { error: `sender ${fromEmail} not on the allow-list` },
      { status: 403 },
    );
  }
  // Switched-off users can't send in (2026-10-21).
  if (appUser.active === false) {
    return NextResponse.json({ error: `sender ${fromEmail} is switched off` }, { status: 403 });
  }
  // The compliance role (0090) files documents only: no new properties or
  // people, no extraction, no commit_batch (which can open deals and write
  // agreement and commission rows). Unmatched email waits in /triage for a
  // director.
  const complianceSender = String(appUser.role) === "compliance";

  const rawSubject = (email.subject ?? "").trim();
  const textBody = (email.text ?? "").trim();

  // 6. Route on subject prefix.
  const { intent, value: subjectValue } = parseSubject(rawSubject);
  const label = (subjectValue.slice(0, 200) || "(untitled intake)").trim();

  const target =
    intent === "client"
      ? await resolveParty(supabase, subjectValue, label, !complianceSender)
      : await resolveProperty(supabase, subjectValue, label, !complianceSender);

  // 7. Create the batch — one of property_id / party_id is set.
  // auto_commit_allowed is set to true here (the intake webhook) so the
  // auto-commit gate below can distinguish webhook-created batches from any
  // other path (manual upload, imported, historical) that must go via /triage.
  const batchInsert: Record<string, unknown> = {
    label: target.batchLabel,
    source: "email",
    created_by: appUser.id,
    sender_email: fromEmail,
    provider_message_id: providerMessageId,
    auto_commit_allowed: true,
  };
  if (complianceSender) batchInsert.auto_commit_allowed = false;
  if (target.id) {
    if (intent === "property") batchInsert.property_id = target.id;
    else batchInsert.party_id = target.id;
  }

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

  // 8. Save the email body as its own file — often carries the address, CMA
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

  // 9. Attachments: fetch each from the signed CDN URL Resend returned, upload
  //    to staging, insert ingest_file rows. One bad attachment doesn't kill
  //    the batch — errors accumulate and are surfaced in the response.
  for (let i = 0; i < attachmentMetas.length; i++) {
    const meta = attachmentMetas[i];
    const name = safeFilename(meta.filename || `attachment-${i + 1}`);
    const contentType = meta.content_type || "application/octet-stream";
    const prefix = String(i + 1).padStart(2, "0");
    const path = `${batch.id}/${prefix}-${name}`;

    // Skip inline email chrome: signature icons (Instagram, LinkedIn, Facebook,
    // Spire, YouTube, and the palm tree graphic that live in every Dream
    // agent's Outlook footer). The reliable signal is the FILENAME shape —
    // Outlook auto-generates `img-<uuid>` or `image001.png` for embedded
    // images without a proper attachment name. Real property photos come
    // through as IMG_1234.JPG, HEIC from iPhones, PHOTO-yyyy-mm-dd.jpg
    // from WhatsApp downloads — none match these patterns.
    //
    // The content_disposition/content_id path stays as a secondary guard for
    // clients that DO set those headers correctly.
    const isImage = /^image\//i.test(contentType);
    const isGeneratedInlineName =
      isImage &&
      (/^img-[0-9a-f]{6,}/i.test(name) ||
        /^image\d+\.(png|jpe?g|gif|webp)$/i.test(name));
    const isInlineImage =
      isImage &&
      (meta.content_disposition?.toLowerCase() === "inline" ||
        !!meta.content_id);
    if (isInlineImage || isGeneratedInlineName) continue;

    // Skip oversized attachments outright — Resend caps at 40 MB total per
    // email but our storage flow bounds each individual file at 20 MB.
    if (meta.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      errors.push(`${name} exceeds ${MAX_ATTACHMENT_MB} MB — skipped`);
      continue;
    }

    let bytes: Buffer;
    try {
      const buf = await fetchAttachmentBytes(meta.download_url);
      bytes = Buffer.from(buf);
    } catch (e) {
      errors.push(`fetch ${name}: ${(e as Error).message}`);
      continue;
    }
    if (bytes.length === 0) continue;

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

  // 10. Classify — sets doc types, PII flags, batch tier, and renames a
  //     generic "(untitled intake)" batch off its best-named document when
  //     possible. Extraction is a review-time step, not run here.
  try {
    await classifyBatchWithClient(batch.id, supabase);
  } catch (e) {
    errors.push(`classify: ${(e as Error).message}`);
  }

  // 10b. Deep classify — content extract + regex rules + LLM fallback for
  //     any file the filename classifier left as "other". Catches the
  //     "PROPERTY DESCRIPTION.docx" / "features.docx" case without needing
  //     the reviewer to press the Reclassify button. LLM only fires on
  //     stragglers, so this stays cheap in the common case.
  let deepChanged = 0;
  try {
    const deep = await deepClassifyBatch(supabase, batch.id);
    deepChanged = deep.changed;
  } catch (e) {
    errors.push(`deep-classify: ${(e as Error).message}`);
  }

  // 11. Auto-file when the batch is a no-brainer: attached to a property on
  //     intake AND every classified file is filing-only (plans, photos,
  //     correspondence — nothing to extract). Skips the triage step for the
  //     common "here are the photos/plans for E105" case. Batches with
  //     agreements/mandates/listings still land in triage for extract review.
  let autoFiled: { filed: number; deduped: number } | null = null;
  let autoExtracted: { rowsInserted: number; used: string[]; mode?: string } | null = null;
  let autoCommitted: {
    propertyId: string | null;
    transferId: string | null;
    filed: number;
    deduped: number;
  } | null = null;
  if (complianceSender) {
    if (target.id) {
      try {
        const res = await fileComplianceBatch(supabase, batch.id, appUser.id, intent, target.id);
        autoFiled = { filed: res.filed, deduped: 0 };
        if (res.error) errors.push(`compliance-file: ${res.error}`);
      } catch (e) {
        errors.push(`compliance-file: ${(e as Error).message}`);
      }
    }
  } else if (intent === "property" && target.id) {
    try {
      const filingOnly = await batchIsFilingOnly(supabase, batch.id);
      if (filingOnly) {
        const res = await fileBatchAgainstPropertyWithClient(
          supabase,
          batch.id,
          appUser.id,
        );
        if (res.ok) {
          autoFiled = { filed: res.filed ?? 0, deduped: res.deduped ?? 0 };
        } else if (res.error) {
          errors.push(`auto-file: ${res.error}`);
        }
      } else {
        // 11b. Extractable content present — auto-run AI extract so ERF,
        //     extent, address, sellers, price, etc. get pulled from the
        //     documents without the reviewer having to press Extract fields.
        try {
          const ex = await extractBatchWithClient(supabase, batch.id);
          if (ex.ok) {
            autoExtracted = {
              rowsInserted: ex.rowsInserted ?? 0,
              used: ex.used ?? [],
              mode: ex.mode,
            };

            // 11c. Auto-commit — populate the property record end-to-end.
            //     Runs when extraction produced rows AND the batch is
            //     attached to a property (so we know where to write).
            //     commit_batch's upsert semantics keep existing property
            //     data safe: null-or-empty extracted values leave existing
            //     values alone; non-null extracted values win.
            if ((ex.rowsInserted ?? 0) > 0) {
              try {
                // Defence-in-depth: only auto-commit batches the webhook
                // itself flagged. Any other batch (manual upload, imported,
                // historical) requires a human to hit Commit in /triage.
                const { data: batchRow } = await supabase
                  .from("ingest_batch")
                  .select("auto_commit_allowed")
                  .eq("id", batch.id)
                  .single();

                if (batchRow?.auto_commit_allowed !== true) {
                  console.warn(
                    `[intake] skipping auto-commit for batch ${batch.id} — auto_commit_allowed not set`,
                  );
                  return NextResponse.json({ ok: true, batchId: batch.id, autoCommitted: false });
                }

                const commit = await commitBatchWithClient(
                  supabase,
                  batch.id,
                  appUser.id,
                );
                if (commit.ok) {
                  autoCommitted = {
                    propertyId: commit.propertyId ?? null,
                    transferId: commit.transferId ?? null,
                    filed: commit.filed ?? 0,
                    deduped: commit.deduped ?? 0,
                  };
                } else if (commit.error) {
                  errors.push(`auto-commit: ${commit.error}`);
                }
              } catch (e) {
                errors.push(`auto-commit: ${(e as Error).message}`);
              }
            }
          } else if (ex.error) {
            errors.push(`auto-extract: ${ex.error}`);
          } else if (ex.note) {
            errors.push(`auto-extract: ${ex.note}`);
          }
        } catch (e) {
          errors.push(`auto-extract: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`auto-file: ${(e as Error).message}`);
    }
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
    attachmentCount: attachmentMetas.length,
    deepClassified: deepChanged,
    autoFiled,
    autoExtracted,
    autoCommitted,
    errors,
  });
}

// GET is convenient for a browser sanity check that the route is reachable.
// No secrets leaked — just confirms the RESEND_WEBHOOK_SECRET env is present.
export async function GET() {
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  return NextResponse.json({
    ok: true,
    ready: Boolean(secret),
    hint: secret
      ? "Ready to receive Resend inbound webhooks."
      : "RESEND_WEBHOOK_SECRET not configured — set on Vercel before Resend can POST here.",
  });
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
  s = s.replace(/^\s*(?:fwd?|re)\s*:\s*/gi, "").trim();

  const m = s.match(/^(property|client|contact)\s*[:—\-]\s*(.+)$/i);
  if (m) {
    const intent: Intent = /^prop/i.test(m[1]) ? "property" : "client";
    return { intent, value: normaliseSubjectValue(m[2]) };
  }
  return { intent: "property", value: normaliseSubjectValue(s) };
}

// Strip trailing document-type words from the subject so both the fuzzy match
// AND (if we end up creating) the new property.primary_address land on a clean
// core address. Bronwyn's convention is `<address> <doc-type words>`, e.g.
//   "House E105 Pezula Private Estate Information and Mandate"
// which reduces to "House E105 Pezula Private Estate". Repeated application
// handles composite tails like "…Information and Mandate".
const SUBJECT_TAIL_NOISE =
  /\s+(?:information|info|mandate|mandates|photos?|images?|pictures?|documents?|docs|files|takeon|take[\s-]?on|cma|listing|detailed|and|&)$/i;
function normaliseSubjectValue(s: string): string {
  let v = s.trim().replace(/[.,;\s]+$/g, "");
  // Repeatedly strip trailing noise words (handles "and Mandate", "and Photos", …).
  for (let i = 0; i < 8; i++) {
    const next = v.replace(SUBJECT_TAIL_NOISE, "").trim();
    if (next === v) break;
    v = next;
  }
  return v;
}

type ResolveResult = {
  id: string | null;
  batchLabel: string;
  matched: boolean;
  matchedName: string | null;
};

async function resolveProperty(
  supabase: SupabaseClient,
  subjectValue: string,
  fallbackLabel: string,
  allowCreate = true,
): Promise<ResolveResult> {
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

  if (!allowCreate) return { id: null, batchLabel: `Unmatched · ${fallbackLabel}`, matched: false, matchedName: null };
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
  allowCreate = true,
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

  if (!allowCreate) return { id: null, batchLabel: `Unmatched client · ${fallbackLabel}`, matched: false, matchedName: null };
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

// Resend's `from` field is a raw string like `"Bronwyn Eyre <bron@...>"` or
// just `"bron@..."`. Extract the address and lowercase.
function normaliseEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/<([^>]+)>/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return addr;
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

// Compliance intake (2026-10-21): file every classified attachment as a
// document — on the property (and its one live deal, if there is exactly
// one) or on the matched person. Nothing is extracted or committed.
async function fileComplianceBatch(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
  intent: "property" | "client",
  targetId: string,
): Promise<{ filed: number; error?: string }> {
  const links: { entity_type: string; entity_id: string }[] = [];
  if (intent === "property") {
    links.push({ entity_type: "property", entity_id: targetId });
    const { data: live } = await supabase
      .from("transfer")
      .select("id")
      .eq("property_id", targetId)
      .in("status", ["preparing", "mandate", "listed", "under_offer", "sale_agreed", "in_conveyancing"]);
    if (live && live.length === 1) links.push({ entity_type: "transfer", entity_id: live[0].id as string });
  } else {
    links.push({ entity_type: "party", entity_id: targetId });
  }
  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename, storage_bucket, storage_path, mime_type, byte_size, is_pii, detected_doc_type_id, status")
    .eq("batch_id", batchId);
  let filed = 0;
  let left = 0;
  for (const f of (files ?? []) as Record<string, unknown>[]) {
    if (f.status === "committed") continue;
    const fname = String(f.original_filename ?? "");
    if (fname.toLowerCase().endsWith(".eml") || /email-body\.txt$/i.test(fname) || String(f.storage_path ?? "").endsWith("00-email-body.txt")) continue;
    if (!f.detected_doc_type_id) {
      left++; // unclassified: leave the batch open in /triage for a director
      continue;
    }
    const { data: doc, error } = await supabase
      .from("document")
      .insert({
        doc_type_id: f.detected_doc_type_id,
        title: f.original_filename,
        storage_bucket: f.storage_bucket,
        storage_path: f.storage_path,
        mime_type: f.mime_type,
        byte_size: f.byte_size,
        is_pii: f.is_pii,
        status: "final",
        uploaded_by: userId,
      })
      .select("id")
      .single();
    if (error || !doc) return { filed, error: error?.message ?? "document insert failed" };
    await supabase.from("document_link").insert(links.map((l) => ({ document_id: doc.id, ...l })));
    await supabase.from("ingest_file").update({ committed_document_id: doc.id, status: "committed" }).eq("id", f.id as string);
    filed++;
  }
  if (!left) await supabase.from("ingest_batch").update({ status: "committed" }).eq("id", batchId);
  return { filed, error: left ? `${left} attachment(s) unclassified — left in triage` : undefined };
}
