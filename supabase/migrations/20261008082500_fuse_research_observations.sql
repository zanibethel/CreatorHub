-- Fuse penny-volatility v1 research observations. No order execution or virtual capital changes.
create table if not exists public.paper_fuse_observations (
  bot_id text not null default 'penny-volatility-day-100' check (bot_id = 'penny-volatility-day-100'),
  strategy_id text not null default 'penny-volatility-day-v1' check (strategy_id = 'penny-volatility-day-v1'),
  strategy_version integer not null default 1 check (strategy_version >= 1),
  symbol text not null check (length(symbol) between 1 and 32),
  bar_bucket_at timestamptz not null,
  evaluated_at timestamptz not null,
  readiness text not null check (readiness in ('rejected','waiting','prepared','research-ready')),
  fuse_score integer not null check (fuse_score between 0 and 100),
  scanner_score numeric,
  market_snapshot jsonb not null default '{}'::jsonb,
  trade_plan jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  primary key (bot_id, strategy_version, symbol, bar_bucket_at)
);
create index if not exists paper_fuse_observations_recent_idx
  on public.paper_fuse_observations (bar_bucket_at desc);
alter table public.paper_fuse_observations enable row level security;
revoke all on public.paper_fuse_observations from anon, authenticated;
comment on table public.paper_fuse_observations is 'Private, idempotent 5m research-only Fuse decisions. Service credential access only. Research-ready is NOT authorization to submit an order.';
