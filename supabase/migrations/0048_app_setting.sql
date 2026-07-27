-- Dream Knysna OS — 0048 app_setting (typed key/value settings)
--
-- Generic key/value store for admin-configurable OS settings. First user:
-- the mandate expiry watchlist (mandate.expiry_window_days = [30, 60])
-- so Bronwyn can tune "how many days out do I want to be warned" without
-- a code change.
--
-- Design notes:
--   - value stored as jsonb so any shape works (arrays, numbers, strings,
--     objects) without a schema-per-setting migration
--   - updated_by nullable so a service-role backfill isn't blocked by RLS
--   - staff READ so the app can render settings-driven UI (like the
--     watchlist thresholds shown on section headers) without an extra
--     admin-only fetch; only admin can WRITE
--   - keys are dotted namespaces ("mandate.expiry_window_days") — no
--     enum, no separate categories column; app-layer convention is enough
--     for a settings surface with < ~20 keys

create table app_setting (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app_user(id) on delete set null
);

create trigger trg_app_setting_updated
  before update on app_setting
  for each row execute function set_updated_at();

alter table app_setting enable row level security;

create policy "app_setting staff read"
  on app_setting for select
  using (is_staff());

create policy "app_setting admin write"
  on app_setting for all
  using (is_admin())
  with check (is_admin());

comment on table app_setting is
  'Admin-configurable OS settings. Dotted-namespace keys, jsonb values. Staff read (so settings-driven UI works for agents too); admin write.';
comment on column app_setting.key is
  'Dotted namespace, e.g. mandate.expiry_window_days. App-layer convention.';
comment on column app_setting.value is
  'jsonb — schema is app-defined per key. Use lib/settings.ts helper for typed reads with defaults.';

-- Seed: mandate expiry warning thresholds. Days ahead of expiry_date at
-- which a mandate lands in each watchlist bucket. Ascending order.
insert into app_setting (key, value) values
  ('mandate.expiry_window_days', '[30, 60]'::jsonb);
