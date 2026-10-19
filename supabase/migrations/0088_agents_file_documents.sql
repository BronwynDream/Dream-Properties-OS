-- Dream Knysna OS — 0088 agents file their own documents (2026-10-19)
--
-- Simon: "the agents should certainly be able to load/file their own
-- documents". Agents upload from the property record (Add documents); the
-- server files the document row and its links after checking they work on
-- that property / deal (app/properties/[id]/actions.ts fileDocuments).
--
-- One storage fix that goes with it. Documents brought in through intake
-- were filed where they landed, in the `staging` bucket (paths
-- "<batch id>/<file>"). 0086 limited staging reads to the batch's sender and
-- directors, so an agent on the deal couldn't open those files even though
-- the document row is theirs to see. A staging file is now also readable
-- when its document row is (the row's own RLS — can_see_document — decides).

drop policy if exists "read staging by batch" on storage.objects;
create policy "read staging by batch" on storage.objects for select
  using (
    bucket_id = 'staging'
    and (
      is_admin()
      or exists (select 1 from public.ingest_batch b
                  where b.id::text = split_part(storage.objects.name, '/', 1)
                    and b.created_by = auth.uid())
      or exists (select 1 from public.document d
                  where d.storage_bucket = 'staging' and d.storage_path = storage.objects.name)
    )
  );
