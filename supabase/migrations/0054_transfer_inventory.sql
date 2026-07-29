-- Transfer-scoped inventory: fixtures (part of the immovable sale, per
-- clause 14 of Bronwyn's Master Sale template) + movables (a separate
-- sale of furniture/appliances/soft furnishings covered by Annexure A of
-- the standalone Movables Agreement).
--
-- Modelled as ONE table with a `category` discriminator because the row
-- shape is identical (description + included + notes) and the UI shows
-- them as two grouped lists. Fixtures default to included; movables
-- default to included when explicitly added.
--
-- Header info for the movables agreement (its own price + effective
-- date + signed doc) piggy-backs on the existing `agreement` table
-- with agreement_type = 'movables' — no separate header table needed.

create type transfer_inventory_category as enum ('fixture', 'movables');

create type transfer_inventory_kind as enum (
  'lighting',            -- fixed light fittings, lamps
  'cupboards_shelving',  -- fitted cupboards, shelving, curtain rails/rods
  'kitchen_appliance',   -- oven, hob, extractor, microwave, dishwasher
  'appliance',           -- toaster, kettle, fridge, iron, TV
  'kitchenware',         -- pots, pans, crockery, cutlery, glassware
  'fireplace',           -- free-standing fireplace, wood stove
  'pool',                -- pool cleaning equipment, pump
  'garden',              -- irrigation, water tanks, garden implements
  'power',               -- invertor, batteries, solar panels
  'keys',                -- keys, remote controls, gate remotes
  'furniture',           -- beds, sofas, tables, chairs, pedestals
  'soft_furnishing',     -- linen, curtains, rugs, cushions, mirrors, towels
  'artwork',             -- artwork, artefacts (usually EXCLUDED)
  'personal',            -- personal items (usually EXCLUDED)
  'other'
);

create table transfer_inventory (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references transfer(id) on delete cascade,
  category     transfer_inventory_category not null,
  kind         transfer_inventory_kind not null default 'other',
  description  text not null,
  is_included  boolean not null default true,
  notes        text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_transfer_inventory_updated
  before update on transfer_inventory
  for each row execute function set_updated_at();

create index idx_transfer_inventory_transfer on transfer_inventory(transfer_id);
create index idx_transfer_inventory_cat on transfer_inventory(transfer_id, category, sort_order);

alter table transfer_inventory enable row level security;

create policy transfer_inventory_read
  on transfer_inventory for select
  using (is_staff());
create policy transfer_inventory_write
  on transfer_inventory for all
  using (is_admin())
  with check (is_admin());
