-- ============================================================================
-- Dream Knysna OS — 0070 feed_run: one row per data-feed run
-- ----------------------------------------------------------------------------
-- Plan 019, Slice H. Simon, 2026-10-14, looking at the live map rail:
-- "not sure all these left-hand buttons will go down well with the agents
-- ... we need a dashboard that has green lights for each section."
--
-- The lights have to be real. Every scheduled or manual run of a feed
-- (Dream website scrape, Property24 refresh, municipal roll import,
-- geocoding passes, the inbound email webhook) writes one row here when it
-- starts and updates it when it finishes. /admin/health reads the latest
-- row per feed and turns it into green / amber / red against the feed's
-- expected cadence.
--
-- Writes come from server routes using the service role, which bypasses
-- RLS. Reads are staff-wide: the map shows every agent a small dot per
-- source so they can see "Property24 data is stale" without being able to
-- do anything about it. The buttons stay admin-only on /admin/health.
-- ============================================================================

create type feed_run_status as enum ('running', 'ok', 'partial', 'error');
create type feed_run_trigger as enum ('cron', 'manual', 'webhook');

create table feed_run (
  id          uuid primary key default gen_random_uuid(),
  feed        text not null,                  -- key from lib/feeds/registry.ts
  trigger     feed_run_trigger not null,
  status      feed_run_status not null default 'running',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  items       int,                            -- rows touched; meaning per feed
  summary     jsonb,                          -- the route's own JSON result
  error       text,
  triggered_by uuid references app_user(id) on delete set null
);

create index idx_feed_run_feed_started on feed_run(feed, started_at desc);

comment on table feed_run is
  'One row per run of a data feed (scrape, import, geocode, webhook). Latest row per feed drives the lights on /admin/health.';
comment on column feed_run.items is
  'Rows touched by the run. Per feed: listings upserted (dream_website, property24), rows imported (muni_roll), rows geocoded (geocode), files received (intake_email).';

alter table feed_run enable row level security;

create policy feed_run_staff_read on feed_run for select using (is_staff());
-- No insert/update policy on purpose: only the service role writes.

-- Latest run per feed, for the health page and the map's source dots.
create or replace view v_feed_latest with (security_invoker = on) as
select distinct on (feed)
  feed, id, trigger, status, started_at, finished_at, items, summary, error
from feed_run
order by feed, started_at desc;

-- security_invoker: the caller's RLS on feed_run applies (staff read).
grant select on v_feed_latest to authenticated;
