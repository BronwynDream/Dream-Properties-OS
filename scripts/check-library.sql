-- Fingerprint of every active document template's wording in the clause
-- library. Run in the Supabase SQL editor after pasting a library migration
-- and compare with the expected values (project.state.md / the session).
-- Whitespace is normalised, so tabs the editor turned into spaces don't
-- count; a dropped or changed character does.
select t.code,
       count(*) as wordings,
       left(md5(string_agg(c.key || '|' || v.label || '|' ||
            md5(btrim(regexp_replace(translate(v.body, chr(160), ' '), '[[:space:]]+', ' ', 'g'))),
            ',' order by c.key, v.label)), 10) as fingerprint
  from doc_template t
  join doc_template_slot s on s.template_id = t.id
  join clause c on c.id = s.clause_id
  join clause_variant v on v.clause_id = c.id
 where t.active
 group by t.code
 order by t.code;
