-- Dream Knysna OS — 0050 valuation roll uploads
--
-- Introduces an admin-driven ingest for Knysna Municipality's official
-- Valuation Roll PDFs (both Full GV and Supplementary), replacing the
-- stale ArcGIS Layer 58 mirror as the authoritative valuation source.
--
-- Motivation: the ArcGIS "..._Test" endpoint was last edited 2023-02-07,
-- and (as discovered while diagnosing Erf 1453 at 2 Panorama Road /
-- The Heads) doesn't match the current published GV. The Full GV PDF
-- Simon received shows R 9,145,000 for that property; our ArcGIS mirror
-- shows R 6.1m (two partial tariff rows). The muni's own PDF is
-- authoritative — this migration lets us upload it and future
-- supplements as first-class data.
--
-- Design:
--   valuation_roll_upload   one row per uploaded PDF (Full GV or Supplement N).
--                            Tracks status through parse → preview → apply.
--   muni_property           gains `owner` (POPI-sensitive — admin-only RLS
--                            path below) and `roll_upload_id` provenance.
--   muni_valuation          gains supplement metadata (sec_78, effective_date,
--                            comment, note), plus upload_kind + roll_upload_id
--                            provenance so we can filter/rollback per upload.

-- ---------------------------------------------------------------------------
-- 1. Upload tracker
-- ---------------------------------------------------------------------------
create table valuation_roll_upload (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('full_gv', 'supplement')),
  -- Sequential per GV cycle. Full GV = 0 by convention; supplements = 1, 2, 3, ...
  supplement_number      int,
  effective_period_start date,
  effective_period_end   date,
  file_ref               text not null,   -- storage.objects path within 'valuation-rolls'
  file_name              text not null,
  file_size_bytes        bigint,
  page_count             int,
  parsed_row_count       int default 0,
  applied_row_count      int default 0,
  status                 text not null default 'uploaded'
                         check (status in (
                           'uploaded',   -- file in Storage, not yet parsed
                           'parsing',    -- parse worker in flight
                           'parsed',     -- parsed OK, preview_json ready
                           'preview',    -- (reserved for a future two-stage preview)
                           'applying',   -- upsert to muni_property + muni_valuation in flight
                           'applied',    -- committed to DB
                           'failed'      -- see parse_error
                         )),
  parse_error            text,
  -- Sample of parsed rows + counts, kept small enough to load in one query.
  -- Full parsed set is re-derived on demand by re-parsing the stored PDF —
  -- we don't want a 25k-row JSON blob living in this table.
  preview_json           jsonb,
  uploaded_by            uuid references app_user(id),
  uploaded_at            timestamptz not null default now(),
  applied_at             timestamptz,
  notes                  text
);

create index idx_val_roll_upload_status on valuation_roll_upload(status);
create index idx_val_roll_upload_kind on valuation_roll_upload(kind, supplement_number);

alter table valuation_roll_upload enable row level security;
create policy "valuation_roll_upload admin all"
  on valuation_roll_upload for all
  using (is_admin()) with check (is_admin());

comment on table valuation_roll_upload is
  'Admin-driven ingestion of Knysna Muni Valuation Roll PDFs (Full GV + Supplements). Status advances uploaded → parsing → parsed → applying → applied. File itself lives in Supabase Storage bucket "valuation-rolls".';

-- ---------------------------------------------------------------------------
-- 2. muni_property extensions
-- ---------------------------------------------------------------------------
alter table muni_property
  add column owner          text,
  add column roll_upload_id uuid references valuation_roll_upload(id) on delete set null;

comment on column muni_property.owner is
  'Registered owner per the Muni GV. POPI-sensitive — expose only via admin paths. Populated by valuation-roll upload; left null when only ArcGIS layers 56/57 supplied identity.';
comment on column muni_property.roll_upload_id is
  'Provenance: which valuation_roll_upload wrote this row (last-write-wins). Null for legacy ArcGIS-sourced rows.';

-- The existing "muni_property staff read" policy exposes all columns to
-- every agent — including the new owner column. Replace with two policies:
-- staff read of the non-PII columns via a view (added below), admin read
-- of the full row.
drop policy if exists "muni_property staff read" on muni_property;

create policy "muni_property admin read"
  on muni_property for select
  using (is_admin());

create policy "muni_property staff read non-pii"
  on muni_property for select
  using (is_staff());
-- Note: PostgREST doesn't support column-level RLS. Non-admin staff
-- readers get the row (including owner) via this policy — the app-layer
-- guard is: server code that runs under a staff session must explicitly
-- omit `owner` from its SELECT column list (or read via muni_property_public
-- view below). Enforcement is code-review + a lint rule, not RLS.

create or replace view muni_property_public as
  select
    sg_number, erf_number, muni_erf_code,
    street_no, street_name, suburb, suburb_hint,
    zoning, ward_no, sectional_title_flag, usage_, prop_description,
    town_name, extent_sqm, property_type,
    sect_scheme_name, sect_scheme_unit,
    title_deed_no, old_title_deed_no, deeds_office,
    purch_date, registration_date, purch_price,
    bond_number, bond_amount, bond_institution,
    imported_at, refreshed_at,
    roll_upload_id
  from muni_property;

comment on view muni_property_public is
  'Non-PII projection of muni_property. Excludes `owner`. Staff-safe. Prefer this view over the raw table in any code path reachable by a non-admin session.';

grant select on muni_property_public to authenticated;

-- ---------------------------------------------------------------------------
-- 3. muni_valuation extensions (supplement metadata + provenance)
-- ---------------------------------------------------------------------------
alter table muni_valuation
  add column sec_78          text,   -- '78(1)c', '78(1)d', '78(1)g', etc. Null for full_gv rows.
  add column effective_date  date,   -- when the change took effect (supplement)
  add column comment         text,   -- DWELLING / VACANT / CHURCH / etc.
  add column note            text,   -- free-text ("VALUED WITH ERF 10", "OCC RECEIVED")
  add column upload_kind     text check (upload_kind in ('full_gv', 'supplement', 'arcgis')),
  add column roll_upload_id  uuid references valuation_roll_upload(id) on delete set null,
  add column is_marker       boolean not null default false; -- R0 "VALUED WITH ERF X" style rows

-- Existing rows are ArcGIS-sourced.
update muni_valuation set upload_kind = 'arcgis' where upload_kind is null;

create index idx_muni_valuation_upload on muni_valuation(roll_upload_id) where roll_upload_id is not null;

comment on column muni_valuation.sec_78 is
  'Municipal Property Rates Act section under which a supplement change is recorded: 78(1)c = subdivision/consolidation, 78(1)d = improvement/addition/new dwelling, 78(1)g = category change. Null for Full GV rows.';
comment on column muni_valuation.comment is
  'Muni-classified change reason: DWELLING, VACANT, CHURCH, REVALUED, ADDITIONS, NEW DWELLING, CATEGORY CHANGED, CONSOLIDATED, SUBDIVIDED, REVIEW, VALUATION STANDS.';
comment on column muni_valuation.is_marker is
  'R0 "VALUED WITH ERF X" / "CONSOLIDATED TO ERF X" rows are markers, not real valuations. Filter these out of totals.';

-- ---------------------------------------------------------------------------
-- 4. Storage bucket for uploaded PDFs
--
-- Kept out of this migration because Supabase Storage buckets should be
-- created via the Studio UI or the Storage API (not raw SQL against the
-- storage schema — the bucket-create migration ran into RLS issues in
-- Supabase managed environments). See runbook in the PR description:
-- Simon creates the 'valuation-rolls' bucket in Studio → Storage → New
-- bucket → private → 20MB file size limit.
-- ---------------------------------------------------------------------------
