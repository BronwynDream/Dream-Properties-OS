-- ============================================================================
-- Dream Knysna OS — 0075 addendum amendments: write-your-own by default
-- ----------------------------------------------------------------------------
-- Bronwyn's master addenda carry an "EXAMPLES:" block where the agent is
-- meant to write the real amendments. On a finalised PDF that block is a
-- trap: the first live finalise printed "EXAMPLES: 1. Clause ___ shall now
-- read…" verbatim. The master wording stays in the library as a reference
-- variant; a new variant that takes the amendments as a field becomes the
-- default, so the editor asks for them and the page shows a gap until they
-- are written.
-- ============================================================================

-- Keep the master, but it is no longer the default and says what it is.
update clause_variant v set is_default = false, label = 'Bronwyn''s examples (reference)'
  from clause c
 where v.clause_id = c.id and v.label = 'Master'
   and c.key in ('addendum.amendments', 'addendum_movables.amendments');

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select c.id, 'Write the amendments', $body$The parties hereby agree that the Agreement of Sale is hereby amended as follows:

{{amendments}}$body$, null, true, 'master_template', true
  from clause c where c.key = 'addendum.amendments'
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select c.id, 'Write the amendments', $body$The parties hereby agree that the Agreement of Sale in respect of Movables is hereby amended as follows:

{{amendments}}$body$, null, true, 'master_template', true
  from clause c where c.key = 'addendum_movables.amendments'
on conflict (clause_id, label) do nothing;
