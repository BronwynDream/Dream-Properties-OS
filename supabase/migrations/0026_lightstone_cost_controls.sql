-- Dream Knysna OS — 0026 Lightstone cost controls
-- Repo copy of the schema Simon applied against Bon Bon's DB. Do NOT re-run.
-- Kept here so a fresh clone can rebuild the database in order.
--
-- Three tables gate every billable Lightstone call:
--   lightstone_budget  — singleton: monthly cap, warn threshold, month key + alert flags
--   lightstone_usage   — per-call ledger (billable + cache_hit + blocked)
--   market_property    — long-lived cache of Lightstone facets keyed by their
--                        propertyId ("Defined Property Layer" id)
--
-- Contract with the app code:
--   lib/lightstone/gateway.ts guardedGet(path, meta) is the ONLY path to
--   billable Lightstone data. It writes to lightstone_usage on every call
--   (including cache_hit + blocked ledger rows for observability) and reads
--   lightstone_budget for cap + threshold decisions.
--
--   lib/market/service.ts checks market_property before calling the gateway;
--   deeds/ownership/last_sale/comparables never time out (only explicit
--   refresh or a new registered transfer forces a refetch); avm ages out
--   after 12 months.

-- Singleton budget row — id is a boolean primary key that only allows the
-- literal `true`, so nobody can insert a second row by accident.
create table lightstone_budget (
  id                   boolean primary key default true check (id),
  monthly_call_budget  int  not null default 200,
  soft_warn_pct        int  not null default 80 check (soft_warn_pct between 1 and 99),
  month_key            text not null default to_char(now() at time zone 'utc', 'YYYY-MM'),
  alerted_soft         bool not null default false,
  alerted_hard         bool not null default false,
  updated_at           timestamptz not null default now()
);
insert into lightstone_budget (id) values (true) on conflict (id) do nothing;

create trigger trg_lightstone_budget_updated
  before update on lightstone_budget
  for each row execute function set_updated_at();

comment on table lightstone_budget is
  'Singleton. monthly_call_budget = hard cap of billable non-cache Lightstone calls per calendar month (UTC). soft_warn_pct fires the first Director email at that % of budget.';
comment on column lightstone_budget.month_key is
  'YYYY-MM (UTC). The gateway resets this + both alert flags when a new month starts.';

-- Per-call ledger. Every guardedGet() lands one row here — including cache
-- hits (billable=true, cache_hit=true so we can see what would otherwise have
-- cost a call) and blocks (blocked=true, billable=false).
create table lightstone_usage (
  id                     uuid primary key default gen_random_uuid(),
  path                   text not null,
  endpoint               text not null,        -- logical bucket: 'legal', 'owners', 'avm', 'address_search', ...
  billable               bool not null default true,
  cache_hit              bool not null default false,
  blocked                bool not null default false,
  http_status            int,
  error                  text,
  user_id                uuid references app_user(id),
  our_property_id        uuid references property(id),
  lightstone_property_id bigint,
  month_key              text generated always as (to_char(created_at at time zone 'utc', 'YYYY-MM')) stored,
  created_at             timestamptz not null default now()
);

-- Fast path for the "how many billable non-cache calls this month?" check
-- the gateway runs on every billable request. Partial so we only index the
-- rows that count against the budget.
create index idx_lightstone_usage_month_billable
  on lightstone_usage(month_key)
  where billable and not cache_hit and not blocked;

create index idx_lightstone_usage_created on lightstone_usage(created_at desc);
create index idx_lightstone_usage_endpoint on lightstone_usage(endpoint);

comment on table lightstone_usage is
  'Ledger of every call the gateway makes. Cache hits + blocks are logged too so admins can see attempted usage without spending.';

-- Cache of Lightstone facets. One row per Defined Property Layer id.
-- Each *_fetched_at column marks when we last pulled that facet fresh.
create table market_property (
  lightstone_property_id  bigint primary key,
  matched_property_id     uuid references property(id) on delete set null,

  address_json            jsonb,
  address_fetched_at      timestamptz,

  legal_json              jsonb,
  legal_fetched_at        timestamptz,

  land_json               jsonb,
  land_fetched_at         timestamptz,

  owners_json             jsonb,
  ownership_fetched_at    timestamptz,

  last_sale_json          jsonb,
  last_sale_fetched_at    timestamptz,

  comparables_json        jsonb,
  comparables_fetched_at  timestamptz,

  avm_json                jsonb,
  avm_fetched_at          timestamptz,

  raw                     jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_market_property_updated
  before update on market_property
  for each row execute function set_updated_at();

create index idx_market_property_matched on market_property(matched_property_id) where matched_property_id is not null;

comment on table market_property is
  'Long-lived cache of Lightstone Property Data facets. Freshness rules live in lib/market/service.ts — deeds/ownership/last_sale/comparables never expire; avm ages out after 12 months.';

-- RLS: budget + usage are admin-only. market_property is staff-readable so a
-- future Market screen can render cached facets without ever needing service
-- role; admin only writes (the gateway uses service role, which bypasses RLS).
alter table lightstone_budget enable row level security;
alter table lightstone_usage  enable row level security;
alter table market_property   enable row level security;

create policy "budget admin all"
  on lightstone_budget for all
  using (is_admin()) with check (is_admin());

create policy "usage admin read"
  on lightstone_usage for select
  using (is_admin());

create policy "market staff read"
  on market_property for select
  using (is_staff());

create policy "market admin write"
  on market_property for all
  using (is_admin()) with check (is_admin());
