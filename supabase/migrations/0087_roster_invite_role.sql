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

-- Camilla is on the team but not on the website's agent list (Simon,
-- 2026-10-19: "you've left out Camilla?"). Loaded as a director-to-be with
-- access off; nobody is emailed until her switch is turned on at /team.
insert into agent (full_name, email, invite_role)
values ('Camilla Anley-Eyre', 'camilla@dreamknysna.co.za', 'admin')
on conflict (email) do update set invite_role = 'admin'
  where agent.app_user_id is null;

-- If she already has a login, link it.
update agent a set app_user_id = u.id
  from app_user u
 where lower(u.email) = lower(a.email) and a.app_user_id is null
   and a.email = 'camilla@dreamknysna.co.za';

notify pgrst, 'reload schema';
