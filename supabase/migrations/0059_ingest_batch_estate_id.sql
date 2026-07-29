-- Route triage batches to an estate rather than a property.
--
-- Some intake batches carry estate-level artefacts (architectural design
-- manual, HOA rules, plant list, disturbance-area plans per plot) that
-- shouldn't be attached to any specific property. Nulls fine for the
-- 99% of batches that are property-scoped.

alter table ingest_batch add column if not exists estate_id uuid references estate(id) on delete set null;
create index if not exists idx_ingest_batch_estate on ingest_batch(estate_id);

comment on column ingest_batch.estate_id is
  'Set when a batch is routed to an estate vault via /triage. Mutually exclusive with property_id in practice — a batch is either about a specific property or about an estate.';
