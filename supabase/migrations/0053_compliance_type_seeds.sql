-- Seed the four Certificates of Compliance types the Master Sale
-- template (clause 15) references. validity_months values are typical
-- SA industry rules of thumb — used by the /compliance page to compute
-- an expected expiry when the seller enters an issue date but no
-- expiry (issue_date + validity months = expiry).
--
-- Codes are stable API tokens. Labels are what the UI shows.
insert into compliance_type (code, label, validity_months) values
  ('electrical',     'Electrical Compliance',    24), -- OHSA 1993 general guidance
  ('entomologist',   'Beetle / Entomologist',    6),  -- typical SAPCA validity
  ('gas',            'Gas Installation',         60), -- OHSA Reg 17(3) ~5y
  ('electric_fence', 'Electric Fence',           24)
on conflict (code) do update
  set label = excluded.label,
      validity_months = excluded.validity_months;
