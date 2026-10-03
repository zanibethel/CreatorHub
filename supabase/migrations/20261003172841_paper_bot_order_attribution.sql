create table public.paper_bot_orders (
  client_order_id text primary key check (char_length(client_order_id) between 12 and 128),
  bot_id text not null references public.paper_bot_ledgers(bot_id) on delete cascade,
  strategy_id text not null,
  strategy_version integer not null check (strategy_version > 0),
  broker_order_id text unique,
  symbol text not null check (char_length(symbol) between 1 and 32),
  asset_class text not null check (asset_class in ('stock','etf','crypto','unknown')),
  side text not null check (side in ('buy','sell')),
  status text not null default 'prepared' check (status in ('prepared','submitted','partially_filled','filled','canceled','rejected','expired','replaced','closed','error')),
  requested_quantity numeric(28,10),
  requested_notional numeric(18,6),
  submitted_at timestamptz,
  last_reconciled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index paper_bot_orders_bot_created_idx on public.paper_bot_orders (bot_id,created_at desc);
create index paper_bot_orders_status_idx on public.paper_bot_orders (status,updated_at desc);

alter table public.paper_bot_orders enable row level security;
revoke all on public.paper_bot_orders from public,anon,authenticated;
grant all on public.paper_bot_orders to service_role;
