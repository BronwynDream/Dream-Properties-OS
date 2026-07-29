-- transfer.status_changed_at: when did this transfer last change stage?
--
-- The Pipeline kanban leans on this to show "days in current stage" —
-- the number that tells Bronwyn "this deal has been stuck in
-- sale_agreed for 14 days, chase the conveyancer". Before this column
-- we'd have had to piggy-back on transfer.updated_at, which changes
-- every time ANY field is edited (party edit, agent reassign, note),
-- so days-in-stage would have been misleadingly small.
--
-- Semantics:
--   backfilled to updated_at at deploy time (best available proxy for
--   historical rows — new stage transitions will be tracked exactly)
--   set by trigger on any status change; not touched on other updates

alter table transfer add column if not exists status_changed_at timestamptz;

update transfer set status_changed_at = updated_at where status_changed_at is null;

alter table transfer alter column status_changed_at set not null;
alter table transfer alter column status_changed_at set default now();

create or replace function set_transfer_status_changed_at()
returns trigger as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_transfer_status_changed_at on transfer;
create trigger trg_transfer_status_changed_at
  before update on transfer
  for each row execute function set_transfer_status_changed_at();

create index if not exists idx_transfer_status_changed_at on transfer(status_changed_at);
