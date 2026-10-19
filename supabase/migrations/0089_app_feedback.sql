-- 0089 — "Something's not right" reports + automatic error capture (2026-10-19)
--
-- Simon: "until we get more users onto the system, we're not really going to be
-- able to bug fix just from my activity." Agents report a problem in one line
-- from any screen (kind = 'report'); crashes and failed loads are logged
-- without anyone having to say so (kind = 'error'). Every row carries who,
-- which page, when, and the device.
--
-- Staff (directors and agents) can write their own rows; only directors read
-- and resolve them (Admin → Reports). Safe to re-run.

create table if not exists app_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null default auth.uid() references app_user(id) on delete cascade,
  kind         text not null check (kind in ('report', 'error')),
  message      text not null check (length(message) between 1 and 4000),
  path         text,
  details      jsonb not null default '{}'::jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid references app_user(id),
  note         text
);

create index if not exists app_feedback_open_idx on app_feedback (created_at desc) where resolved_at is null;

alter table app_feedback enable row level security;

drop policy if exists app_feedback_insert on app_feedback;
create policy app_feedback_insert on app_feedback for insert
  with check (is_staff() and user_id = auth.uid() and resolved_at is null);

drop policy if exists app_feedback_read on app_feedback;
create policy app_feedback_read on app_feedback for select using (is_admin());

drop policy if exists app_feedback_resolve on app_feedback;
create policy app_feedback_resolve on app_feedback for update using (is_admin()) with check (is_admin());

grant select, insert, update on app_feedback to authenticated;
