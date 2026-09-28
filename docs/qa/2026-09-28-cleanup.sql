-- ============================================================================
-- Cleanup script — 2026-09-28 live walkthrough remediation
-- Source doc: docs/qa/2026-09-28-live-walkthrough.md
--
-- WORKING RULES (Simon, 2026-09-28):
--   1. Every write statement is COMMENTED OUT. Uncomment ONE BLOCK AT A
--      TIME after eyeballing the enumeration + row-6 enum check below.
--   2. Do NOT batch blocks together; each stands alone.
--   3. Prefer MERGE / RENAME over DELETE.
--   4. Before every DELETE property row, uncomment the paired VERIFICATION
--      SELECT and confirm it returns zero rows.
--   5. Run as your admin session (NOT service_role) so audit_log rows
--      attribute correctly. merge_properties() (0013_dupe_finder.sql:214)
--      raises "not authorised to merge" against service_role.
--   6. Block ordering matters. Row 1 renames 1d10d487 to the canonical
--      "26 Lower Duthie, Knysna" FIRST. Rows 2 and 3 then merge INTO it.
--
-- Enumeration output from Simon (2026-09-28):
--   id        address                          transfers docs
--   4a168a11  26 Lower Duthie - Rates account      1       2
--   216c31a3  26 Lower Duthie Pics                 0      22
--   1d10d487  26 Lower Duthie Seller Details       1       4
--   c7642caa  Dream Properties - Master Templates  1       3
--   4eca6574  Hudson Heights                       0       0
--   0c4c5952  Pezula … Design Manual …             1      14
--   369aa728  Plot: 21 Emu Crescent … continued    0       5
--   0a1874ed  PLOT19 Eagles Way - proposed plans   0       1
--
-- Canonical property rows referenced below:
--   b55806c1  19 Eagles Way, Knysna Heads
--   da685a45  21 EMU CRESCENT, KNYSNA HEADS
--   (no canonical "26 Lower Duthie" exists — Row 1 becomes canonical)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Step 0 — RE-ENUMERATION (READ-ONLY). Re-run first to confirm nothing
-- has shifted since the walkthrough. Counts must match the header above.
-- If any row has grown listings/mandates/erven since then, STOP and reassess.
-- ---------------------------------------------------------------------------

with candidates as (
  select id, primary_address
  from property
  where id in (
    '4a168a11'::uuid, '216c31a3'::uuid, '1d10d487'::uuid, 'c7642caa'::uuid,
    '4eca6574'::uuid, '0c4c5952'::uuid, '369aa728'::uuid, '0a1874ed'::uuid
  )
)
select
  c.id,
  c.primary_address,
  (select count(*) from transfer   t where t.property_id = c.id)                                    as transfers,
  (select count(*) from listing    l where l.property_id = c.id)                                    as listings,
  (select count(*) from mandate    m
     join listing l on l.id = m.listing_id where l.property_id = c.id)                              as mandates,
  (select count(*) from erf        e where e.property_id = c.id)                                    as erven,
  (select count(*) from document_link dl where dl.entity_type='property' and dl.entity_id = c.id)   as doc_links,
  (select count(*) from ingest_batch ib where ib.property_id = c.id)                                as batches,
  (select count(*) from compliance_cert cc where cc.property_id = c.id)                             as cocs,
  (select count(*) from communication co where co.property_id = c.id)                               as comms
from candidates c
order by c.primary_address;


-- ---------------------------------------------------------------------------
-- Step 0b — DOCUMENT_LINK ENUM CHECK (READ-ONLY). Only needed for Row 6
-- (Pezula) which repoints doc_links from property → estate. Confirms 'estate'
-- is a valid entity_type before we try to update. If it isn't, Row 6's
-- repoint step aborts with a check-constraint violation.
-- ---------------------------------------------------------------------------

-- Look up the exact allowed values of document_link.entity_type. If the
-- column uses an enum, list the enum members. If it uses a CHECK constraint
-- against text literals, list those.

-- select column_name, data_type, udt_name
--   from information_schema.columns
--  where table_name = 'document_link' and column_name = 'entity_type';

-- If udt_name is an enum type (e.g. 'document_link_entity_type'), list its
-- values (substitute the actual type name):
-- select unnest(enum_range(NULL::document_link_entity_type));

-- If the column is text with a CHECK, inspect the constraint:
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'document_link'::regclass
--    and contype = 'c';

-- Confirm 'estate' appears among the allowed values. If it does not,
-- STOP before Row 6 — the fix is either to add 'estate' to the enum
-- (out of scope for this cleanup) or to use a different destination
-- (e.g. a "Pezula Estate Documents" holding property).


-- ---------------------------------------------------------------------------
-- Step 0c — CANONICAL LOOKUP (READ-ONLY). Confirm the two canonicals
-- Simon named still exist and match their addresses.
-- ---------------------------------------------------------------------------

-- select id, primary_address, extent_sqm, title_deed_no
--   from property
--  where id in ('b55806c1'::uuid, 'da685a45'::uuid);

-- Expected:
--   b55806c1 — "19 Eagles Way, Knysna Heads"
--   da685a45 — "21 EMU CRESCENT, KNYSNA HEADS"


-- ============================================================================
-- Row 1 (MUST run first) — rename 1d10d487 to canonical "26 Lower Duthie, Knysna"
-- ----------------------------------------------------------------------------
-- Before: primary_address = '26 Lower Duthie Seller Details'
-- After:  primary_address = '26 Lower Duthie, Knysna'
-- This row keeps its id and becomes the merge target for Rows 2 and 3.
-- ============================================================================

-- update property
--    set primary_address = '26 Lower Duthie, Knysna'
--  where id = '1d10d487'::uuid;

-- Verify the rename landed:
-- select id, primary_address from property where id = '1d10d487'::uuid;


-- ============================================================================
-- Row 2 — 4a168a11 "26 Lower Duthie - Rates account"
--   (a) cancel the duplicate preparing transfer on 4a168a11 first, so it
--       lands on the canonical as cancelled (visible in pipeline history,
--       not a live deal)
--   (b) merge 4a168a11 into 1d10d487
-- ============================================================================

-- 2a — cancel the transfer that got auto-created against the junk row.
-- Reason recorded so future audits can trace it back to this cleanup:
-- update transfer
--    set status = 'cancelled',
--        status_changed_at = now(),
--        notes = coalesce(notes || E'\n---\n', '') ||
--                'Cancelled 2026-09-28: duplicate transfer created against ' ||
--                'junk property row 4a168a11 (26 Lower Duthie - Rates account) ' ||
--                'from folder migration. Cleanup script: docs/qa/2026-09-28-cleanup.sql'
--  where property_id = '4a168a11'::uuid;

-- Confirm one row cancelled (expected: 1):
-- select id, status, status_changed_at from transfer where property_id = '4a168a11'::uuid;

-- 2b — merge. merge_properties preserves the winner id and repoints all
-- transfers/listings/document_links/erven/etc from loser to winner, then
-- deletes the loser. The cancelled transfer from 2a becomes a cancelled
-- transfer on 1d10d487.
-- select merge_properties(
--   '1d10d487'::uuid,
--   '4a168a11'::uuid,
--   'folder-migration cleanup: 26 Lower Duthie rates-account folder mis-imported as property'
-- );

-- Verify:
-- select id, primary_address from property where id in ('4a168a11'::uuid, '1d10d487'::uuid);
-- Expected: only 1d10d487 remains.


-- ============================================================================
-- Row 3 — 216c31a3 "26 Lower Duthie Pics"
--   Zero transfers, 22 doc_links. Straight merge into canonical.
-- ============================================================================

-- select merge_properties(
--   '1d10d487'::uuid,
--   '216c31a3'::uuid,
--   'folder-migration cleanup: 26 Lower Duthie photos folder mis-imported as property (22 docs)'
-- );

-- Verify:
-- select id, primary_address from property where id = '216c31a3'::uuid;
-- Expected: 0 rows (loser deleted).
-- select count(*) from document_link where entity_type='property' and entity_id = '1d10d487'::uuid;
-- Expected: >= 26 (4 original on 1d10d487 + 22 from 216c31a3, minus any that dedup-collided
-- on (document_id, entity_type, entity_id) in merge_properties step 4).


-- ============================================================================
-- Row 4 — 0a1874ed "PLOT19 Eagles Way - proposed plans"
--   Zero transfers, 1 doc_link. Merge into canonical b55806c1
--   (19 Eagles Way, Knysna Heads).
-- ============================================================================

-- select merge_properties(
--   'b55806c1'::uuid,
--   '0a1874ed'::uuid,
--   'folder-migration cleanup: proposed-plans folder mis-imported as property; also fixes PLOT19 typo'
-- );

-- Verify:
-- select id from property where id = '0a1874ed'::uuid;
-- Expected: 0 rows.


-- ============================================================================
-- Row 5 — 369aa728 "Plot: 21 Emu Crescent, The Heads continued"
--   Zero transfers, 5 doc_links. Merge into canonical da685a45
--   (21 EMU CRESCENT, KNYSNA HEADS) — NOT rename, per Simon's instruction.
-- ============================================================================

-- select merge_properties(
--   'da685a45'::uuid,
--   '369aa728'::uuid,
--   'folder-migration cleanup: email-continued suffix mis-imported as property'
-- );

-- Verify:
-- select id from property where id = '369aa728'::uuid;
-- Expected: 0 rows.


-- ============================================================================
-- Row 6 — 0c4c5952 "Pezula ... Design Manual ..."
--   1 transfer, 14 doc_links. Not a property at all — it's a folder of
--   Pezula estate reference material.
--
--   Sequence:
--     6a — retype all 14 documents as estate_design_manual
--     6b — repoint 14 doc_links from property=0c4c5952 → estate=<pezula id>
--     6c — cancel + delete the transfer that got auto-created
--     6d — VERIFY zero remaining property-scoped references
--     6e — delete the property row
--
--   Pre-req: run Step 0b first. If document_link.entity_type does NOT
--   accept 'estate', STOP — this cleanup needs a different destination.
--   Fallback: use a "Pezula Estate Documents" holding property row
--   (create manually via admin UI first, then use its id instead of
--   the estate id in 6b).
-- ============================================================================

-- 6-prep — find the Pezula estate id.
-- select id, name from estate where name ilike 'pezula%';
-- Note the id and substitute for <pezula id> in 6a and 6b.

-- 6a — retype the 14 documents. estate_design_manual code exists per
-- lib/classify.ts:35 rule; confirm it also seeds in document_type:
-- select id from document_type where code = 'estate_design_manual';
-- If that returns 0 rows, plan 017 seeds it — coordinate ordering.

-- update document
--    set doc_type_id = (select id from document_type where code = 'estate_design_manual')
--  where id in (
--    select document_id from document_link
--    where entity_type = 'property' and entity_id = '0c4c5952'::uuid
--  );

-- Confirm 14 rows updated (expected):
-- select count(*) from document d
--   join document_link dl on dl.document_id = d.id
--   left join document_type dt on dt.id = d.doc_type_id
--  where dl.entity_type = 'property' and dl.entity_id = '0c4c5952'::uuid
--    and dt.code = 'estate_design_manual';

-- 6b — repoint the doc_links to the Pezula estate row.
-- update document_link
--    set entity_type = 'estate',
--        entity_id   = '<paste pezula estate id>'::uuid
--  where entity_type = 'property'
--    and entity_id   = '0c4c5952'::uuid;

-- Confirm 14 rows repointed:
-- select count(*) from document_link
--  where entity_type = 'estate' and entity_id = '<paste pezula estate id>'::uuid;

-- 6c — cancel + delete the transfer. Cancel records the intent in
-- audit_log; delete releases the property FK so 6e can succeed.
-- update transfer
--    set status = 'cancelled',
--        status_changed_at = now(),
--        notes = coalesce(notes || E'\n---\n', '') ||
--                'Cancelled + deleted 2026-09-28: junk property row 0c4c5952 ' ||
--                '(Pezula design-manual folder). Cleanup: docs/qa/2026-09-28-cleanup.sql'
--  where property_id = '0c4c5952'::uuid;

-- delete from transfer where property_id = '0c4c5952'::uuid;

-- 6d — VERIFY zero remaining references. All of these must return 0
-- BEFORE running 6e:
-- select
--   (select count(*) from transfer     where property_id = '0c4c5952'::uuid) as transfers_left,
--   (select count(*) from listing      where property_id = '0c4c5952'::uuid) as listings_left,
--   (select count(*) from erf          where property_id = '0c4c5952'::uuid) as erven_left,
--   (select count(*) from document_link
--     where entity_type='property' and entity_id = '0c4c5952'::uuid)         as doclinks_left,
--   (select count(*) from ingest_batch where property_id = '0c4c5952'::uuid) as batches_left,
--   (select count(*) from compliance_cert where property_id = '0c4c5952'::uuid) as cocs_left,
--   (select count(*) from communication  where property_id = '0c4c5952'::uuid) as comms_left,
--   (select count(*) from property_ownership_history
--     where property_id = '0c4c5952'::uuid)                                   as ownership_left;

-- 6e — delete the property row. Only if 6d returned all zeros.
-- delete from property where id = '0c4c5952'::uuid;


-- ============================================================================
-- Row 7 — c7642caa "Dream Properties - Master Templates"
--   1 transfer, 3 doc_links. Not a property. Simon: cancel transfer, delete
--   property. (No doc-repoint mentioned — the 3 documents may be Bronwyn's
--   contract masters which live better on the Pezula-holding side or nowhere
--   at all. If you want to preserve them, repoint before delete.)
--
--   Sequence:
--     7a — delete the 3 doc_links (documents themselves stay in the
--          document table + storage; only their property association goes)
--     7b — cancel + delete the transfer
--     7c — VERIFY zero references
--     7d — delete the property
--
--   Alternative for 7a: if the 3 documents ARE the contract master PDFs
--   Bronwyn shipped 2026-09-17 (docs/templates/2026-final/*), they might
--   already be superseded by the extracted-text markdown in the repo — in
--   which case delete the underlying document rows too. Inspect first:
--   select d.id, d.title, d.storage_bucket, d.storage_path, dt.code
--     from document d
--     left join document_type dt on dt.id = d.doc_type_id
--     join document_link dl on dl.document_id = d.id
--    where dl.entity_type = 'property' and dl.entity_id = 'c7642caa'::uuid;
-- ============================================================================

-- 7a — delete the doc_link rows (document rows stay in storage).
-- delete from document_link
--  where entity_type = 'property' and entity_id = 'c7642caa'::uuid;

-- 7b — cancel + delete the transfer.
-- update transfer
--    set status = 'cancelled',
--        status_changed_at = now(),
--        notes = coalesce(notes || E'\n---\n', '') ||
--                'Cancelled + deleted 2026-09-28: junk property row c7642caa ' ||
--                '(Dream Properties - Master Templates). Cleanup: docs/qa/2026-09-28-cleanup.sql'
--  where property_id = 'c7642caa'::uuid;

-- delete from transfer where property_id = 'c7642caa'::uuid;

-- 7c — VERIFY zero references.
-- select
--   (select count(*) from transfer     where property_id = 'c7642caa'::uuid) as transfers_left,
--   (select count(*) from listing      where property_id = 'c7642caa'::uuid) as listings_left,
--   (select count(*) from erf          where property_id = 'c7642caa'::uuid) as erven_left,
--   (select count(*) from document_link
--     where entity_type='property' and entity_id = 'c7642caa'::uuid)         as doclinks_left,
--   (select count(*) from ingest_batch where property_id = 'c7642caa'::uuid) as batches_left,
--   (select count(*) from compliance_cert where property_id = 'c7642caa'::uuid) as cocs_left,
--   (select count(*) from communication  where property_id = 'c7642caa'::uuid) as comms_left,
--   (select count(*) from property_ownership_history
--     where property_id = 'c7642caa'::uuid)                                   as ownership_left;

-- 7d — delete the property. Only if 7c returned all zeros.
-- delete from property where id = 'c7642caa'::uuid;


-- ============================================================================
-- Row 8 — 4eca6574 "Hudson Heights"
--   Zero transfers, zero docs. Deletion is trivial.
--   HOLD until Bronwyn confirms Hudson Heights is not a real
--   scheme/development they intend to track. Kept in its own block so
--   the rest of the cleanup can proceed without waiting.
-- ============================================================================

-- 8a — one last look at what it is (extent + suburb + any erven).
-- select id, primary_address, extent_sqm, suburb_id,
--   (select count(*) from erf where property_id = property.id) as erven
-- from property where id = '4eca6574'::uuid;

-- 8b — VERIFY zero references (should already be zero per enumeration).
-- select
--   (select count(*) from transfer     where property_id = '4eca6574'::uuid) as transfers_left,
--   (select count(*) from listing      where property_id = '4eca6574'::uuid) as listings_left,
--   (select count(*) from erf          where property_id = '4eca6574'::uuid) as erven_left,
--   (select count(*) from document_link
--     where entity_type='property' and entity_id = '4eca6574'::uuid)         as doclinks_left;

-- 8c — delete the property. Only after Bronwyn confirms.
-- delete from property where id = '4eca6574'::uuid;


-- ============================================================================
-- GV CLEANUP — unlink the two KNYSNA-FULL-GV PDF copies from 6 Bowden Park
-- ----------------------------------------------------------------------------
-- Two document rows: 4e64d78b, 6ced0b39
-- Current state: storage_bucket 'staging', is_pii true,
-- doc_type_id fa53fec3 = 'id_document' (mislabelled by content classifier
-- from the density of names + ID numbers in a 22k-row roll).
--
-- Correct treatment:
--   (a) Unlink both from 6 Bowden Park (they are municipality-wide data,
--       not a per-property document). Leave the document rows in storage.
--   (b) Set doc_type to 'other' with is_pii = false, so they surface neither
--       as a property document nor as a FICA-flagged record.
--   (c) Simon: check whether the file has been ingested via
--       /admin/valuation-rolls. If not, upload it there (that flow parses
--       into muni_property + muni_valuation, which is what the map + erf
--       lookup actually read).
--
-- If /admin/valuation-rolls already has the roll, the two document rows
-- are entirely redundant — delete them plus their storage files after (b).
-- ============================================================================

-- GV-a — confirm current state.
-- select id, title, storage_bucket, storage_path, doc_type_id, is_pii, byte_size
--   from document
--  where id in ('4e64d78b'::uuid, '6ced0b39'::uuid);

-- select dl.document_id, dl.entity_type, dl.entity_id, p.primary_address
--   from document_link dl
--   left join property p on p.id = dl.entity_id
--  where dl.document_id in ('4e64d78b'::uuid, '6ced0b39'::uuid);

-- GV-b — unlink from 6 Bowden Park. Both properties (per plan 015's
-- dupe finding) may have the doc linked; unlink from both.
-- delete from document_link
--  where document_id in ('4e64d78b'::uuid, '6ced0b39'::uuid)
--    and entity_type = 'property';

-- GV-c — reclassify to 'other', unset PII.
-- update document
--    set doc_type_id = (select id from document_type where code = 'other'),
--        is_pii = false
--  where id in ('4e64d78b'::uuid, '6ced0b39'::uuid);

-- GV-d — OPTIONAL: if /admin/valuation-rolls already has the roll,
-- delete the redundant document rows + purge storage. Check first:
-- select id, filename, applied_at from valuation_roll_upload
--   where filename ilike '%KNYSNA%FULL%GV%';

-- If a valuation_roll_upload row exists with a matching filename AND
-- applied_at is populated (roll already loaded into muni_property), the
-- two document rows are duplicates and can go:
-- delete from document where id in ('4e64d78b'::uuid, '6ced0b39'::uuid);
-- (Storage-side purge of the two staging PDF files is a separate step —
--  Simon does via Supabase Storage UI or `supabase storage rm`.)


-- ============================================================================
-- POST-CLEANUP VERIFICATION — run after all uncommented blocks executed.
-- ============================================================================

-- 1. All eight junk IDs no longer resolve to a property row (0 rows,
--    except 4eca6574 if Bronwyn is still confirming Hudson Heights).
-- select id, primary_address
--   from property
--  where id in (
--    '4a168a11'::uuid, '216c31a3'::uuid, '1d10d487'::uuid, 'c7642caa'::uuid,
--    '4eca6574'::uuid, '0c4c5952'::uuid, '369aa728'::uuid, '0a1874ed'::uuid
--  );
-- Expected: 1 row (1d10d487, now "26 Lower Duthie, Knysna"), and possibly
-- 4eca6574 if the Hudson Heights block hasn't run yet.

-- 2. audit_log confirms each merge/delete.
-- select action, entity_type, entity_id, justification, created_at
--   from audit_log
--  where entity_type in ('property', 'transfer')
--    and created_at >= '2026-09-28'
--  order by created_at desc;

-- 3. Dupe finder now surfaces any remaining "26 Lower Duthie" duplicates
--    (if 1d10d487 needs to merge with another canonical, this is where
--    it shows up).
-- select * from find_property_dupes(0.85, 20);

-- 4. Pezula estate now shows its 14 design-manual documents.
-- select count(*) from document_link
--  where entity_type = 'estate'
--    and entity_id = '<paste pezula estate id>'::uuid;
-- Expected: 14 (or more if the estate already had others).
