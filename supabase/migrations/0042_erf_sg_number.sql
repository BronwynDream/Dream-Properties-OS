-- ============================================================================
-- Dream Knysna OS — 0042 erf.sg_number for muni disambiguation
-- ----------------------------------------------------------------------------
-- Real-world bug (25 Jul 2026): 12 Eagles Way's ERF 2934 rendered TWO muni
-- cards on the property page — one for the actual Heads property, one for
-- a Sedgefield Erf 2934 that happens to share the same short number.
--
-- Root cause: erf numbers aren't unique across the muni. They're unique per
-- suburb. The SG21 code encodes the region (position 5, e.g. "5" for Heads,
-- "1" for Sedgefield). Storing the SG on erf lets us join muni_property
-- exactly by sg_number rather than falling back to the ambiguous erf_number.
--
-- The column is nullable — legacy erf rows (LLM-extracted, manually typed)
-- may not have an SG. Muni-picker flow populates it going forward.
-- ============================================================================

alter table erf add column if not exists sg_number text;

create index if not exists idx_erf_sg_number
  on erf(sg_number)
  where sg_number is not null;

comment on column erf.sg_number is
  'Full SG21 code (e.g. C03900050000293400000) when this erf was assigned via muni lookup. Used to disambiguate erf numbers that repeat across Knysna suburbs. Nullable — legacy / manual erfs may lack it.';
