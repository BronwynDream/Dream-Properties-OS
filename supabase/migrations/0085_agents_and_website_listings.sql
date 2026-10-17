-- Dream Knysna OS — 0085 agents, co-agents, and website listings (2026-10-17)
--
-- Simon: "The website is a complete listing of what's on the books. What we
-- now need to do is take all of those listings, bring them into Dream OS,
-- and assign them to an agent. Then when an agent logs in, they can see the
-- listings that are associated with them."
--
-- 1. agent — the roster, keyed by email. An agent exists here before they
--    have a login (app_user.id is auth.users.id, so it can't be created
--    ahead of an invite). When their login is created with the same email,
--    a trigger links the two and every listing they're on follows.
-- 2. listing_agent — most website listings carry two agents (Bronwyn +
--    Vanessa, Jo + Angie…). Both see the listing; position 1 is the lead.
--    listing.agent_user_id stays as "the lead's login" for older screens.
-- 3. listing.website_slug — the dreamknysna.co.za page this listing is.
--    The daily website feed keys its sync on it.
-- 4. Suburbs the website uses that weren't seeded.
-- 5. The eight website listings that already exist in Dream OS are linked to
--    their property by hand (matched by erf size + price, 2026-10-17), so
--    the sync attaches to them instead of creating duplicates.

-- ---------------------------------------------------------------------------
-- Suburbs
-- ---------------------------------------------------------------------------
insert into suburb (name, town) values
  ('Paradise', 'Knysna'), ('Knysna Heights', 'Knysna'), ('Knysna Central', 'Knysna'),
  ('Hunters Home', 'Knysna'), ('Fernwood', 'Knysna'), ('Westford Bridge', 'Knysna'),
  ('Welbedacht', 'Knysna'), ('Old Place', 'Knysna'), ('The Point', 'Knysna'),
  ('Gouna', 'Knysna'), ('Karatara', 'Knysna'), ('Featherbed', 'Knysna')
on conflict (name, town) do nothing;

-- ---------------------------------------------------------------------------
-- Agent roster
-- ---------------------------------------------------------------------------
create table if not exists agent (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  email        citext not null unique,
  phone        text,
  app_user_id  uuid unique references app_user(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table agent is
  'Dream agents, keyed by email. Exists before the agent has a login; app_user_id is linked automatically when an app_user with the same email appears (trg_app_user_links_agent).';

create table if not exists listing_agent (
  listing_id  uuid not null references listing(id) on delete cascade,
  agent_id    uuid not null references agent(id) on delete restrict,
  position    smallint not null default 1,
  created_at  timestamptz not null default now(),
  primary key (listing_id, agent_id)
);
create index if not exists idx_listing_agent_agent on listing_agent(agent_id);

comment on table listing_agent is
  'Agents on a listing. position 1 = lead; every agent here sees the listing as theirs.';

alter table listing add column if not exists website_slug    text unique;
alter table listing add column if not exists website_url     text;
alter table listing add column if not exists website_seen_at timestamptz;

-- A property created from a website listing that published no street
-- address is named after the listing ("Inviting Calm, Leisure Isle") and
-- flagged, so the agent knows to fill the address in.
alter table property add column if not exists address_to_confirm boolean not null default false;

comment on column property.address_to_confirm is
  'True when primary_address is a placeholder (website listing title + area). The agent should replace it with the street address; editing the address clears the flag.';

comment on column listing.website_slug is
  'dreamknysna.co.za/knysna-properties/<slug>/ — the website page this listing is. Set by the website sync.';

-- ---------------------------------------------------------------------------
-- RLS: staff read, admin write (the sync runs as service role)
-- ---------------------------------------------------------------------------
alter table agent         enable row level security;
alter table listing_agent enable row level security;

drop policy if exists agent_read on agent;
drop policy if exists agent_write on agent;
create policy agent_read  on agent for select using (is_staff());
create policy agent_write on agent for all using (is_admin()) with check (is_admin());

drop policy if exists listing_agent_read on listing_agent;
drop policy if exists listing_agent_write on listing_agent;
create policy listing_agent_read  on listing_agent for select using (is_staff());
create policy listing_agent_write on listing_agent for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Link an agent to their login by email, whenever the login appears
-- ---------------------------------------------------------------------------
create or replace function link_agent_to_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then return new; end if;

  update agent
     set app_user_id = new.id, updated_at = now()
   where lower(email) = lower(new.email)
     and (app_user_id is null or app_user_id = new.id);

  -- Older screens read listing.agent_user_id: give it the lead's login.
  update listing l
     set agent_user_id = new.id
    from listing_agent la
    join agent a on a.id = la.agent_id
   where la.listing_id = l.id
     and la.position = 1
     and a.app_user_id = new.id
     and l.agent_user_id is null;

  return new;
end;
$$;

drop trigger if exists trg_app_user_links_agent on app_user;
create trigger trg_app_user_links_agent
  after insert or update of email on app_user
  for each row execute function link_agent_to_login();

-- ---------------------------------------------------------------------------
-- The roster, from the agent cards on dreamknysna.co.za (2026-10-17)
-- ---------------------------------------------------------------------------
insert into agent (full_name, email, phone) values
  ('Bronwyn Eyre',       'bron@dreamknysna.co.za',    '+27 82 577 4984'),
  ('Vanessa Eyre',       'vanessa@dreamknysna.co.za', '+27 82 361 6873'),
  ('Angie Bevan',        'angie@dreamknysna.co.za',   '+27 72 127 6837'),
  ('Avril Steele',       'avril@dreamknysna.co.za',   '+27 83 658 8139'),
  ('Jo Lellyett',        'jo@dreamknysna.co.za',      '+27 82 807 4947'),
  ('Gael de Kock',       'gael@dreamknysna.co.za',    '+27 82 663 1504'),
  ('Charmaine Pallent',  'charms@dreamknysna.co.za',  '+27 83 251 3379')
on conflict (email) do nothing;

-- Anyone who already has a login with one of these emails.
update agent a
   set app_user_id = u.id
  from app_user u
 where lower(u.email) = lower(a.email)
   and a.app_user_id is null;

-- ---------------------------------------------------------------------------
-- Website listings already in Dream OS (matched 2026-10-17 by erf size and
-- price; see project.state.md). The sync attaches to these properties.
-- ---------------------------------------------------------------------------
update external_listing el
   set matched_property_id = m.property_id::uuid
  from (values
    ('the-eagles-way',                    'b3a041a7-3e5b-4915-8324-ff75cd7929fc'),  -- 12 Eagles Way
    ('a-feature-packed-eco-masterpiece',  'ef7edf70-321d-4967-a281-3e35bd67a25c'),  -- House E105, Pezula
    ('the-st-james-of-knysna',            '0370a817-6d9d-4e71-a7c8-286cd504f65b'),  -- 4 Waterfront Drive
    ('jaw-dropping-knysna-views',         'a337e928-2f90-4e7e-b099-2d692367dce5'),  -- 25 Ridge Drive (268 m²)
    ('inviting-the-outdoors-in',          '575a2cf5-6d0b-4e92-8f91-0dd6e9da4d1c'),  -- 159 Sharples Close (1 043 m²)
    ('vision-meets-the-beauty-of-knysna', '4eca6574-db3f-4ffc-ad69-d0df724f970c'),  -- Hudson Heights
    ('freehold-with-views-forever',       'b55806c1-a93e-4310-a8b3-13423e83da35'),  -- 19 Eagles Way (approved plans)
    ('dual-living-home-with-bb',          '0af3d8a4-8ab5-4e70-b0cc-e9cb342af312')   -- 6 Bowden Park (1 373 m²)
  ) as m(slug, property_id)
 where el.source = 'dream_website'
   and el.source_ref = m.slug
   and exists (select 1 from property p where p.id = m.property_id::uuid);

-- ---------------------------------------------------------------------------
-- Agents fill in the blanks on their own listings (Simon, 2026-10-17: "the
-- agent can fill in the blanks if there are any on the property record").
-- Property and erf writes stay admin-only otherwise.
-- ---------------------------------------------------------------------------
create or replace function agent_on_property(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from listing l
      join listing_agent la on la.listing_id = l.id
      join agent a on a.id = la.agent_id
     where l.property_id = pid
       and a.app_user_id = auth.uid()
       and a.active
  );
$$;

drop policy if exists property_agent_update on property;
create policy property_agent_update on property
  for update using (agent_on_property(id)) with check (agent_on_property(id));

drop policy if exists erf_agent_write on erf;
create policy erf_agent_write on erf
  for insert with check (agent_on_property(property_id));
drop policy if exists erf_agent_update on erf;
create policy erf_agent_update on erf
  for update using (agent_on_property(property_id)) with check (agent_on_property(property_id));
