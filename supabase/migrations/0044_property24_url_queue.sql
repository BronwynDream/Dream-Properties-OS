-- ============================================================================
-- Dream Knysna OS — 0044 property24_url_queue
-- ----------------------------------------------------------------------------
-- Problem seen 2026-07-26: the Property24 refresh route re-walked the entire
-- Knysna P24 index on every invocation. Index discovery via Firecrawl takes
-- 5-10s per page × 5-20 pages = 100-200s. With Vercel's 300s ceiling, that
-- left almost no time to scrape detail pages (~20s each). Result: 241s wall,
-- 1 successful detail scrape, 45 URLs "left" that would just be re-discovered
-- next run.
--
-- Fix: persist discovered URLs in this small queue. Discovery walks the index
-- only when the queue is EMPTY; subsequent runs just drain the queue in
-- batches of ~12 details per invocation.
--
-- Flow:
--   1. Count pending rows (processed_at IS NULL). If 0, run full discovery
--      and upsert URLs on conflict do nothing.
--   2. Take the next N pending URLs (ordered by discovered_at ASC).
--   3. Scrape each via Firecrawl, upsert to external_listing.
--   4. Mark queue row processed (or delete — either works; keeping the row
--      lets us know we've seen this URL before).
--
-- Refresh cycle: once every URL in the queue is processed, the queue is
-- effectively "drained" and the next invocation will re-discover. Weekly
-- cron will therefore re-walk the index once every N weeks (depending on
-- how many listings need scraping vs the batch cap). Add a manual
-- "force rediscover" trigger later if a fresher refresh cadence is needed.
-- ============================================================================

create table if not exists property24_url_queue (
  url            text primary key,
  discovered_at  timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists idx_p24_queue_pending
  on property24_url_queue(discovered_at)
  where processed_at is null;

comment on table property24_url_queue is
  'Property24 detail URLs discovered from the Knysna index, awaiting Firecrawl scrape. Drained in batches by /api/sources/property24/refresh. Discovery only re-walks the index when this queue is empty.';

-- RLS: service role writes (bypasses); staff can read for admin diagnostics.
alter table property24_url_queue enable row level security;
drop policy if exists "p24 queue staff read" on property24_url_queue;
create policy "p24 queue staff read" on property24_url_queue
  for select using (is_staff());
