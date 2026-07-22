# Dream Properties CRM — WhatsApp Conversation Data Model
Schema brief for engineering implementation (Claude Code)

## Purpose

Extend the Dream Properties CRM (listings, ERF/property records, buyer & seller records, currently synced with email via Microsoft Graph/Azure) to ingest, store, and surface WhatsApp conversations between agents and clients.

Core design principle: **a conversation belongs to the person, not the deal.** Every WhatsApp thread is anchored to a Person record for its full lifetime. A Deal/Opportunity is a separate object that *references* relevant conversations — it does not own them. This means conversations that never convert to a signed deal are never lost or orphaned; they remain on the person's record, searchable and reportable.

Ingestion is via the Meta WhatsApp Cloud API (single verified business number for Dream Properties), received over webhook, matched to a person by phone number, and written into the schema below.

---

## Entities

### `people`

Role-agnostic. A person is not fixed as "buyer" or "seller" — that role is contextual to a specific deal (see `deals` below), since the same person can be a seller on one transaction and a buyer on another, sometimes concurrently.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `full_name` | text, nullable | May be unknown until first real conversation/enquiry resolves it |
| `primary_phone_e164` | text, unique, indexed | Canonical matching key for WhatsApp. Normalize to E.164 on write. |
| `email` | text, nullable | For cross-referencing existing email-based records |
| `status` | enum | `lead`, `active`, `dormant`, `past_client` — see retention policy below |
| `source` | text, nullable | e.g. `whatsapp_inbound`, `listing_enquiry`, `referral` |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### `person_phone_numbers` (optional, recommended for MVP+1)

Allows matching when a person messages from more than one number over time (common — new phone, second SIM, etc.). Not required for v1 if you're comfortable with single-phone matching initially, but worth stubbing now to avoid a painful migration later.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `person_id` | uuid, FK → people.id | |
| `phone_e164` | text, unique, indexed | |
| `is_primary` | boolean | |

### `conversations`

One row per WhatsApp thread (Meta's model is effectively one open-ended thread per phone number against your business number — treat it as a durable thread, not a per-session object).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `person_id` | uuid, FK → people.id, nullable | Nullable only transiently — see matching logic |
| `wa_phone_number` | text, indexed | Raw number as received, pre-normalization fallback |
| `status` | enum | `active`, `dormant`, `archived` |
| `first_message_at` | timestamp | |
| `last_message_at` | timestamp | |
| `created_at` | timestamp | |

### `messages`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `conversation_id` | uuid, FK → conversations.id | |
| `wa_message_id` | text, unique, indexed | Meta's message ID — **use this for idempotency**, webhooks can redeliver |
| `direction` | enum | `inbound`, `outbound` |
| `agent_id` | uuid, FK → agents.id, nullable | Null for inbound client messages |
| `message_type` | enum | `text`, `image`, `document`, `template`, `location`, `other` |
| `body_text` | text, nullable | |
| `media_url` | text, nullable | Store in your own object storage, not just Meta's temp URL (expires) |
| `template_name` | text, nullable | Set when message_type = template |
| `delivery_status` | enum | `sent`, `delivered`, `read`, `failed` |
| `sent_at` | timestamp | |
| `created_at` | timestamp | |

### `deals`

Your existing property-transaction/opportunity object — shown here only for the fields relevant to this integration. Extend your actual deals table with these if not already present.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `listing_id` | uuid, FK → listings.id | |
| `buyer_person_id` | uuid, FK → people.id, nullable | |
| `seller_person_id` | uuid, FK → people.id, nullable | |
| `agent_id` | uuid, FK → agents.id | |
| `stage` | enum | `enquiry`, `viewing_scheduled`, `offer_made`, `under_contract`, `signed`, `lost`, `withdrawn` |
| `created_at` | timestamp | |
| `closed_at` | timestamp, nullable | |

### `conversation_deal_links`

Junction table. Many-to-many by design: the same buyer conversation might touch multiple listings/deals over months (agent shows them five properties before one sticks), and you don't want to fork the conversation history each time.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `conversation_id` | uuid, FK → conversations.id | |
| `deal_id` | uuid, FK → deals.id | |
| `linked_at` | timestamp | |
| `linked_by` | enum | `system_auto`, `agent_manual` |

Unique constraint on (`conversation_id`, `deal_id`).

---

## Matching & linking logic

**Inbound message arrives →**
1. Normalize sender phone to E.164.
2. Look up `people` (or `person_phone_numbers` if implemented) by phone.
3. If no match: create a new `people` row with `status = lead`, `source = whatsapp_inbound`.
4. Find or create the `conversations` row for that person (one active conversation per person is the default assumption — confirm this holds for your use case).
5. Insert `messages` row, keyed on `wa_message_id` for idempotency (upsert, ignore on conflict).
6. Update `conversations.last_message_at`.

**Deal creation →**
- When a deal is created against a `buyer_person_id` or `seller_person_id`, check for an existing conversation for that person and auto-create a `conversation_deal_links` row (`linked_by = system_auto`).
- Agents can also manually link/unlink a conversation to a deal from the UI (`linked_by = agent_manual`) — covers cases where the auto-match is wrong or a conversation should be shared across two deals.
- The link is not date-bounded: once linked, the full conversation history (before and after the deal opened) is visible from the deal view. Simpler than filtering by date range, and usually what agents actually want to see.

**Conversations with no linked deal** simply remain visible on the `people` record's timeline, filterable by `status`. This is the answer to "where do non-converting conversations go" — nowhere special, they just never get a `conversation_deal_links` row. Recommended: surface a `people.status` transition rule — e.g. `lead` → `dormant` if no deal and no message activity for 90 days — so agents get a filtered "active leads" view instead of an ever-growing undifferentiated list.

---

## Ingestion pipeline (implementation notes)

1. Meta Cloud API webhook → signature-verified receiver endpoint → push raw payload onto a queue immediately, return `200 OK` (Meta will retry on non-2xx, and retries plus queueing prevent request timeouts from stalling delivery).
2. Background worker consumes queue, applies matching logic above.
3. Outbound sends (agent replies) go through the same Cloud API, respecting the 24-hour free-form window: template messages required outside that window, plain text inside it. Track this at `conversations` level (derivable from `last_message_at` vs now) so the UI can warn an agent before they try to send a non-template message outside the window.

---

## Compliance note (flag for confirmation, not a legal opinion)

Non-converting `people` records still hold personal data under POPIA. Recommended default: automatic flag (not auto-delete) for review when `status = dormant` for 12 months with no deal ever created, so someone makes an active retention/deletion decision rather than data accumulating indefinitely. Confirm actual retention period with whoever owns compliance for Dream Properties.

---

## Open questions for engineering to confirm before implementation

1. Can one person have more than one *simultaneously active* conversation (e.g., messaging about two unrelated listings at once), or is "one active conversation per person" a safe assumption for v1?
2. Is `person_phone_numbers` (multi-number matching) needed for v1, or acceptable to add later?
3. Should `messages.media_url` content be re-hosted in your own storage immediately on ingestion (recommended, since Meta's media URLs expire), and if so, what's the storage target?
4. Confirm the dormant/retention threshold (90 days lead dormancy, 12 months for compliance flag, as drafted above) against actual business practice.
