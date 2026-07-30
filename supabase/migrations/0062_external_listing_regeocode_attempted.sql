-- Track when we last *attempted* to regeocode an external_listing,
-- separate from any success/failure of that attempt. Without this,
-- the /api/sources/property24/regeocode-jsonld drain loop can't
-- advance: it orders by prcl_key nulls first, but no-hit rows never
-- have prcl_key modified, so successive clicks re-scan the same 15
-- rows. Bronwyn clicked 3× and processed the same batch each time
-- (2026-07-30).
--
-- Bump this column on every regeocode attempt, then order the drain
-- query by it (nulls first, then oldest). That way every click drains
-- new rows regardless of hit/miss.

alter table external_listing
  add column if not exists regeocode_attempted_at timestamptz;

-- Index supports the nulls-first order-by in the drain query. Small
-- table (~500 rows Dream-scale) but the query happens per-click and
-- we want it snappy.
create index if not exists idx_external_listing_regeocode_attempted
  on external_listing (regeocode_attempted_at nulls first);

comment on column external_listing.regeocode_attempted_at is
  'Timestamp of last regeocode-jsonld backfill attempt. Separate from last_seen (source-liveness) and prcl_key (parcel snap). Ordering key for the drain loop so successive clicks progress even when a row returns no-hit.';
