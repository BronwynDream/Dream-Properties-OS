-- Dream Knysna OS — 0087 the role a roster person is invited as (2026-10-19)
--
-- Simon: "I'd like to load everyone and not have to send an invite, the
-- invite should only go out when we flick the toggle to active."
-- The agent roster (0085) now also holds people who aren't on the website
-- (e.g. Camilla, a director). invite_role is the access role their login
-- gets when a director switches them on at /team; until then nobody is
-- emailed and they have no access.

alter table agent add column if not exists invite_role app_role not null default 'agent';

comment on column agent.invite_role is
  'Role the login is created with when access is switched on at /team (agent or admin = director). No effect once the login exists; change roles in the team list.';

notify pgrst, 'reload schema';
