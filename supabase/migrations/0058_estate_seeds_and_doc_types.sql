-- Estate document vault — seeds + extra doc_type codes.
--
-- The `estate` table has existed since 0002_core.sql but nothing populated
-- it. Bronwyn's 28 Jul intake brought a mound of Pezula Private Estate
-- documents (design manual, plant list, disturbance-area plans per plot,
-- home rentals rules) with nowhere to file them. This seeds the three
-- estates Dream deals with most often + a few doc_type codes so those
-- filings classify cleanly instead of falling into "Other".
--
-- All inserts are on-conflict-do-nothing so re-running is safe.

insert into estate (name, kind, hoa_name)
values
  ('Pezula Private Estate',                   'estate', 'Pezula Private Estate HOA'),
  ('Thesen Islands Homeowners Association',   'estate', 'TIHOA'),
  ('Leisure Isle',                            'estate', null),
  ('Simola Golf & Country Estate',            'estate', 'Simola HOA'),
  ('The Heads',                               'estate', null)
on conflict do nothing;

insert into document_type (code, label, category, is_pii_default, retention_years)
values
  ('estate_rules',        'Estate Rules & Regulations', 'compliance', false, null),
  ('estate_plant_list',   'Estate Plant List',          'compliance', false, null),
  ('disturbance_area',    'Disturbance Area Plan',      'plan',       false, null),
  ('estate_general_info', 'Estate General Information', 'compliance', false, null)
on conflict (code) do nothing;
