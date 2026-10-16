-- ============================================================================
-- Dream Knysna OS — 0073 document finalisation + signed-copy register
-- ----------------------------------------------------------------------------
-- Plan 019, Arc A5. A draft can now be finalised: the resolved document is
-- rendered to PDF, stored in the documents bucket, filed as a `document` row
-- (status 'final') and linked to the property / transfer / mandate. Once the
-- seller has signed, the agent uploads the signed copy (PDF or a phone photo)
-- and it is filed as a second `document` (status 'executed') that supersedes
-- the unsigned print. Both land on the draft so the register can answer
-- "prepared when, printed when, signed when" from one row.
--
-- Also sets doc_template.doc_type_id, which 0065 created but never filled,
-- so a finalised PDF files under the right document_type without the code
-- carrying a lookup table.
-- ============================================================================

alter table document_draft
  add column if not exists signed_document_id uuid references document(id) on delete set null,
  add column if not exists signed_at timestamptz,
  add column if not exists signed_by uuid references app_user(id) on delete set null;

comment on column document_draft.rendered_document_id is
  'The frozen, unsigned PDF produced at finalisation (document.status = final).';
comment on column document_draft.signed_document_id is
  'The signed copy uploaded after signature (document.status = executed, supersedes rendered_document_id).';

create index if not exists idx_document_draft_rendered on document_draft(rendered_document_id);
create index if not exists idx_document_draft_signed   on document_draft(signed_document_id);

-- Template → document_type. Mandates of every kind file as 'mandate'; the
-- three sale agreements as 'agreement_of_sale' except land, which has its
-- own type; movables and addenda likewise; the condition report appendix is
-- part of the PPRA disclosure pack.
update doc_template t set doc_type_id = dt.id
from document_type dt
where dt.code = case t.code
  when 'mandate_exclusive'        then 'mandate'
  when 'mandate_joint'            then 'mandate'
  when 'mandate_open'             then 'mandate'
  when 'agreement_sale_house'     then 'agreement_of_sale'
  when 'agreement_sale_sectional' then 'agreement_of_sale'
  when 'agreement_sale_land'      then 'land_freehold_agreement'
  when 'movables_agreement'       then 'movables_agreement'
  when 'addendum_sale'            then 'addendum'
  when 'addendum_movables'        then 'addendum'
  when 'condition_report_appendix' then 'ppra_disclosure'
  else null
end
and t.doc_type_id is null;
