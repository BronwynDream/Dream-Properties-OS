-- Dream Knysna OS — 0030 cadastre import: consecutive_fail cross-batch retries
-- One tiny column on the singleton cursor. When a CSG paging fetch times out
-- (AbortError, distinct from a real HTTP 4xx/5xx), we increment this counter
-- and return the batch without advancing offset. Next batch tries the same
-- offset. Only after 3 consecutive timeouts do we skip forward. HTTP + ArcGIS
-- errors still skip immediately.

alter table cadastral_import_cursor
  add column if not exists consecutive_fail int not null default 0;

comment on column cadastral_import_cursor.consecutive_fail is
  'Timeout retries at the current offset. Incremented on AbortError; reset on success / HTTP error / ArcGIS error. When it reaches 3, the cursor advances anyway and the counter resets.';
