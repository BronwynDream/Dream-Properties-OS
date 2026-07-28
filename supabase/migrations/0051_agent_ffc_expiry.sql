-- Dream Knysna OS — 0051 agent FFC expiry tracking
--
-- Adds date fields so we can watch when agents' Fidelity Fund Certificates
-- expire. Per PPRA (Property Practitioners Regulatory Authority), no
-- property practitioner may earn commission without a valid FFC — an
-- expired certificate isn't just paperwork, it silently invalidates every
-- deal that agent signs. Currently the ppra_ffc column stores the number
-- but not its validity window, so nobody knows when a renewal is due.
--
-- Design:
--   - `ffc_issue_date` and `ffc_expiry_date` on app_user (dates only,
--     ignoring intra-day time — PPRA cycles are annual/rolling).
--   - Warning thresholds in app_setting mirror the mandate watchlist
--     pattern: staff-configurable days-ahead-of-expiry buckets. Default
--     [30, 60, 90] — 90 days out is usually when the PPRA renewal window
--     opens; 30 days is action-now.
--   - No new table, no new RLS — reuses app_user's existing admin-write
--     / staff-read policies (0005_rls).

alter table app_user
  add column if not exists ffc_issue_date  date,
  add column if not exists ffc_expiry_date date;

comment on column app_user.ffc_issue_date is
  'When the current PPRA Fidelity Fund Certificate was issued. Optional (some agents track only expiry).';
comment on column app_user.ffc_expiry_date is
  'When the current FFC expires. Agents cannot legally earn commission past this date — surfaced on /compliance and the admin dashboard attention row before it lapses.';

-- Watchlist thresholds, following the same lib/settings.ts registry
-- pattern used for mandate.expiry_window_days.
insert into app_setting (key, value)
values ('ffc.expiry_window_days', '[30, 60, 90]'::jsonb)
on conflict (key) do nothing;
