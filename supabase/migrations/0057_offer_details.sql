-- Extend the offer table with the fields that make offers comparable.
--
-- The existing offer table (0003_deal.sql) captured amount + deposit +
-- purchaser + status. In real Knysna practice, what makes one offer
-- beat another is rarely the price alone — it's:
--   1. bonded vs cash (bonded offers can fail at bond approval)
--   2. whether the buyer has a property of their own to sell first
--   3. occupation date + occupational rent
--   4. how long the offer stays open (offer expiry)
--
-- The Master Sale template shipped by Bronwyn (28 Jul) has clauses for
-- each of these; this migration mirrors those clauses as typed columns
-- so a comparison view can rank offers on more than just amount.
--
-- Everything is nullable — legacy offers survive without backfill.

alter table offer add column if not exists bond_required             boolean;
alter table offer add column if not exists bond_amount               numeric(14,2);
alter table offer add column if not exists bond_days                 integer;      -- days for bond approval, clause 8
alter table offer add column if not exists sale_of_property_required boolean;
alter table offer add column if not exists sale_of_property_details  text;         -- what property + by when, clause 25
alter table offer add column if not exists deposit_due_date          date;
alter table offer add column if not exists occupation_date           date;         -- clause 5
alter table offer add column if not exists occupational_rent_amount  numeric(10,2); -- monthly rand
alter table offer add column if not exists offer_expires_at          timestamptz;  -- clause 13
alter table offer add column if not exists extra_conditions          text;         -- freeform for anything not templated

comment on column offer.bond_required is
  'true = buyer needs a bond (offer subject to bond approval); false = cash; null = unknown';
comment on column offer.bond_days is
  'Days allowed for bond approval per clause 8; typically 30, may auto-extend by another 30';
comment on column offer.offer_expires_at is
  'Per clause 13: the first signature = irrevocable offer until this deadline';
