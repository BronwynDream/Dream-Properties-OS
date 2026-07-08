-- Dream Knysna OS — 0024 app_user profile fields
-- Two additive fields to make the Team & Access screen expressive without
-- affecting RLS or the role model:
--   job_title  — free-text label distinct from access role. Vanessa has
--                agent access but her marketing title is "Sales & Marketing";
--                the two should not have to agree.
--   phone      — mobile / WhatsApp reachable number, agent-facing only.
--
-- Access role stays app_user.role (app_role enum). Nothing here touches
-- policies or is_admin() / is_staff() — /team uses the existing admin write
-- policy on app_user.

alter table app_user
  add column if not exists job_title text,
  add column if not exists phone     text;

comment on column app_user.job_title is
  'Marketing/business title (e.g. "Sales & Marketing"). Separate from access role — display only.';
comment on column app_user.phone is
  'Contact number (mobile / WhatsApp). Staff-visible.';
