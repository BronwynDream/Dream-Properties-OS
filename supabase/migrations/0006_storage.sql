-- ============================================================================
-- Dream Knysna OS — 0006 storage: private buckets + object policies
-- ----------------------------------------------------------------------------
-- Three private buckets. Nothing is public; the app serves files via short-lived
-- signed URLs. 'fica' is the most sensitive (IDs, marriage certs, KYC).
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('documents', 'documents', false),
  ('media',     'media',     false),
  ('fica',      'fica',      false)
on conflict (id) do nothing;

-- Documents + media: any active staff may read/upload; admins may delete.
create policy "staff read documents"
  on storage.objects for select
  using (bucket_id in ('documents','media') and is_staff());

create policy "staff upload documents"
  on storage.objects for insert
  with check (bucket_id in ('documents','media') and is_staff());

create policy "admin delete documents"
  on storage.objects for delete
  using (bucket_id in ('documents','media') and is_admin());

-- FICA bucket: admins only for the baseline (agent-scoped signed URLs are issued
-- by the app via an edge function once the transfer-scoping is wired).
create policy "admin read fica"
  on storage.objects for select
  using (bucket_id = 'fica' and is_admin());

create policy "admin write fica"
  on storage.objects for insert
  with check (bucket_id = 'fica' and is_admin());

create policy "admin delete fica"
  on storage.objects for delete
  using (bucket_id = 'fica' and is_admin());
