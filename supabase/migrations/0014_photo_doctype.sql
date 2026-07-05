-- ============================================================================
-- Dream Knysna OS — 0014 photo doc_type: catch-up seed row for existing DBs
-- ----------------------------------------------------------------------------
-- seed.sql now includes a `photo` document_type row (category='photo'), but
-- Bon Bon's Database was seeded before it existed, so a fresh `on conflict do
-- nothing` insert here brings it into any environment that already ran the
-- earlier seed. Safe to re-run.
-- ============================================================================

insert into document_type (code, label, category, is_pii_default, retention_years)
values ('photo','Property Photograph','photo', false, null)
on conflict (code) do nothing;
