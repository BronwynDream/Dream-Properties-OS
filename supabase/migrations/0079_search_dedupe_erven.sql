-- ============================================================================
-- Dream Knysna OS — 0079 search: one row per erf
-- ----------------------------------------------------------------------------
-- 0077's erf branch returned the same erf twice when the municipal roll
-- holds more than one row for it ("Erf 16067 · THE GROVE" ×2 live, 17 Oct).
-- Same function, erf branch de-duplicated on erf number + street address.
-- ============================================================================

create or replace function search_everything(q text, per_kind int default 5)
returns table (kind text, id text, title text, subtitle text, href text, score real)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  term   text := btrim(regexp_replace(coalesce(q, ''), '\s+', ' ', 'g'));
  like_t text;
  num    text;   -- a leading street number, "13 campbell" → 13
  rest   text;   -- the words after it,        "13 campbell" → campbell
  is_num boolean;
begin
  if length(term) < 2 then
    return;
  end if;
  like_t := '%' || replace(replace(term, '%', ''), '_', '') || '%';
  num    := substring(term from '^(\d+)\s');
  rest   := btrim(regexp_replace(term, '^\d+\s+', ''));
  is_num := term ~ '^\d+$';

  -- Properties: address, erf number, title deed.
  return query
  select 'property'::text, p.id::text, p.primary_address,
         concat_ws(' · ',
           (select 'Erf ' || string_agg(e.erf_number, ', ') from erf e where e.property_id = p.id),
           s.name),
         '/properties/' || p.id,
         greatest(
           case when exists (select 1 from erf e where e.property_id = p.id and e.erf_number = term) then 1.0 else 0 end,
           case when p.title_deed_no ilike term then 1.0 else 0 end,
           case when p.primary_address ilike like_t then 0.8 else 0 end,
           word_similarity(term, coalesce(p.primary_address, ''))
         )::real as sc
    from property p
    left join suburb s on s.id = p.suburb_id
   where p.primary_address ilike like_t
      or term <% p.primary_address
      or p.title_deed_no ilike term
      or exists (select 1 from erf e where e.property_id = p.id and e.erf_number = term)
   order by sc desc
   limit per_kind;

  -- Deals (transfers): the deal name ("7 The Grove Sofianos to Davis").
  return query
  select 'deal'::text, t.id::text, t.name,
         replace(t.status::text, '_', ' '),
         '/properties/' || t.property_id,
         greatest(case when t.name ilike like_t then 0.8 else 0 end, word_similarity(term, t.name))::real as sc
    from transfer t
   where t.name ilike like_t or term <% t.name
   order by sc desc
   limit per_kind;

  -- People: name, email, phone; ID / passport / registration number match
  -- exactly but are never shown.
  return query
  select 'person'::text, pa.id::text, pa.display_name,
         nullif(concat_ws(' · ', pa.email::text, pa.phone), ''),
         '/contacts/' || pa.id,
         greatest(
           case when pa.id_number = term or pa.passport_no = term or pa.registration_no = term then 1.0 else 0 end,
           case when pa.email::text ilike term then 1.0 else 0 end,
           case when pa.display_name ilike like_t then 0.8 else 0 end,
           word_similarity(term, pa.display_name)
         )::real as sc
    from party pa
   where pa.display_name ilike like_t
      or term <% pa.display_name
      or pa.email::text ilike like_t
      -- Phone: compare the last nine digits, so 082 555 1234, 0825551234
      -- and +27 82 555 1234 are the same number.
      or (length(regexp_replace(term, '\D', '', 'g')) >= 9
          and right(regexp_replace(coalesce(pa.phone, ''), '\D', '', 'g'), 9) = right(regexp_replace(term, '\D', '', 'g'), 9))
      or pa.id_number = term or pa.passport_no = term or pa.registration_no = term
   order by sc desc
   limit per_kind;

  -- Prepared documents (drafts from the clause library).
  return query
  select 'draft'::text, d.id::text, coalesce(d.title, 'Document'),
         d.status::text,
         '/documents/' || d.id,
         greatest(case when d.title ilike like_t then 0.8 else 0 end, word_similarity(term, coalesce(d.title, '')))::real as sc
    from document_draft d
   where d.title ilike like_t or term <% d.title
   order by sc desc
   limit per_kind;

  -- Filed documents: title, or words in the OCR'd text. Opens the property
  -- the document is filed on.
  return query
  select 'document'::text, doc.id::text, doc.title,
         coalesce(dt.label, 'Document'),
         (select '/properties/' || dl.entity_id from document_link dl
           where dl.document_id = doc.id and dl.entity_type = 'property' limit 1),
         greatest(
           case when doc.title ilike like_t then 0.8 else 0 end,
           word_similarity(term, doc.title),
           case when to_tsvector('english', coalesce(doc.ocr_text, '')) @@ plainto_tsquery('english', term) then 0.6 else 0 end
         )::real as sc
    from document doc
    left join document_type dt on dt.id = doc.doc_type_id
   where doc.title ilike like_t
      or term <% doc.title
      or to_tsvector('english', coalesce(doc.ocr_text, '')) @@ plainto_tsquery('english', term)
   order by sc desc
   limit per_kind;

  -- Market listings (Property24 / Private Property / the Dream website).
  return query
  select 'market'::text, x.id::text, coalesce(x.headline, x.address_raw, x.source_ref),
         concat_ws(' · ',
           x.source::text,
           x.agency_name,
           case when x.price is not null then 'R ' || to_char(x.price, 'FM999G999G999') end,
           case when not x.active then 'off market' end),
         case when x.lat is not null and x.lng is not null
              then '/map?lng=' || x.lng || '&lat=' || x.lat
              else x.url end,
         greatest(
           case when x.source_ref = term then 1.0 else 0 end,
           case when x.address_raw ilike like_t or x.headline ilike like_t then 0.7 else 0 end,
           word_similarity(term, coalesce(x.address_raw, '')),
           word_similarity(term, coalesce(x.headline, ''))
         )::real as sc
    from external_listing x
   where x.source_ref = term
      or x.address_raw ilike like_t
      or x.headline ilike like_t
      or term <% x.address_raw
   order by x.active desc, sc desc
   limit per_kind;

  -- Erven on the municipal roll: by erf number, or by street address
  -- ("13 campbell" → street_no 13 on a street like 'campbell'). The roll can
  -- hold several rows for one erf (portions, re-imports), so one row per
  -- erf + address.
  return query
  select 'erf'::text, d.sg_number, d.title, d.subtitle, d.href, d.sc
    from (
      select distinct on (m.erf_number, coalesce(m.street_no, ''), coalesce(m.street_name, ''))
             m.sg_number,
             'Erf ' || m.erf_number || coalesce(' · ' || nullif(btrim(concat_ws(' ', m.street_no, m.street_name)), ''), '') as title,
             concat_ws(' · ', m.suburb, case when m.extent_sqm is not null then m.extent_sqm || ' m²' end) as subtitle,
             '/erf-lookup?q=' || m.erf_number as href,
             (case when m.erf_number = term then 1.0 else 0.7 end)::real as sc
        from muni_property m
       where (is_num and m.erf_number = term)
          or (length(rest) >= 3 and m.street_name ilike '%' || rest || '%' and (num is null or m.street_no = num))
       order by m.erf_number, coalesce(m.street_no, ''), coalesce(m.street_name, ''), m.extent_sqm desc nulls last
    ) d
   order by d.sc desc, d.title
   limit per_kind;

  -- Estates.
  return query
  select 'estate'::text, es.id::text, es.name,
         replace(es.kind::text, '_', ' '),
         '/estates/' || es.id,
         greatest(case when es.name ilike like_t then 0.8 else 0 end, word_similarity(term, es.name))::real as sc
    from estate es
   where es.name ilike like_t or term <% es.name
   order by sc desc
   limit per_kind;
end;
$$;

revoke all on function search_everything(text, int) from public;
grant execute on function search_everything(text, int) to authenticated;
