create table if not exists public.paper_capital_plan (
  plan_id text primary key,
  total_capital numeric(14,6) not null check (total_capital >= 0),
  bot_pool_capital numeric(14,6) not null check (bot_pool_capital > 0),
  reserved_bot_pools integer not null check (reserved_bot_pools >= 0),
  allocated_capital numeric(14,6) not null check (allocated_capital >= 0),
  unallocated_reserve numeric(14,6) not null check (unallocated_reserve >= 0),
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (allocated_capital + unallocated_reserve = total_capital),
  check (allocated_capital = bot_pool_capital * reserved_bot_pools)
);

insert into public.paper_capital_plan(
  plan_id,total_capital,bot_pool_capital,reserved_bot_pools,
  allocated_capital,unallocated_reserve,currency,metadata,updated_at
) values (
  'main',1000,100,5,500,500,'USD',
  '{
    "model":"reserved-bot-pools",
    "description":"Five $100 bot pools reserved now; remaining $500 held for future bot pools.",
    "executionVenueBalanceIsNotProgramCapital":true,
    "marketDataProviderIsImplementationDetail":true
  }'::jsonb,
  now()
)
on conflict (plan_id) do update set
  total_capital=excluded.total_capital,
  bot_pool_capital=excluded.bot_pool_capital,
  reserved_bot_pools=excluded.reserved_bot_pools,
  allocated_capital=excluded.allocated_capital,
  unallocated_reserve=excluded.unallocated_reserve,
  currency=excluded.currency,
  metadata=excluded.metadata,
  updated_at=now();

update public.paper_bot_ledgers
set starting_cash=100,
    metadata=metadata || jsonb_build_object(
      'capitalPlanId','main',
      'capitalPoolUsd',100,
      'capitalPoolReserved',true,
      'programCapitalUsd',1000
    ),
    updated_at=now()
where bot_id in (
  'default-diverse',
  'penny-volatility-day-100',
  'three-trade-weekly-swing-100',
  'crypto-swing-100',
  'weekend-crypto-day-100'
);

update public.paper_bot_ledgers
set metadata=metadata || jsonb_build_object(
  'capitalPoolIndex',
  case bot_id
    when 'default-diverse' then 1
    when 'penny-volatility-day-100' then 2
    when 'three-trade-weekly-swing-100' then 3
    when 'crypto-swing-100' then 4
    when 'weekend-crypto-day-100' then 5
  end
)
where bot_id in (
  'default-diverse',
  'penny-volatility-day-100',
  'three-trade-weekly-swing-100',
  'crypto-swing-100',
  'weekend-crypto-day-100'
);

alter table public.paper_capital_plan enable row level security;
revoke all on table public.paper_capital_plan from public,anon,authenticated;
grant all on table public.paper_capital_plan to service_role;
