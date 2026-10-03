alter table public.paper_bot_orders
  add column if not exists take_profit_price numeric(28,10),
  add column if not exists take_profit_fraction numeric(10,6)
    check (take_profit_fraction is null or (take_profit_fraction > 0 and take_profit_fraction <= 1)),
  add column if not exists take_profit_r numeric(10,6),
  add column if not exists protect_winner_at_r numeric(10,6),
  add column if not exists trail_remainder boolean not null default false;

alter table public.paper_bot_positions
  add column if not exists take_profit_price numeric(28,10),
  add column if not exists take_profit_fraction numeric(10,6)
    check (take_profit_fraction is null or (take_profit_fraction > 0 and take_profit_fraction <= 1)),
  add column if not exists take_profit_r numeric(10,6),
  add column if not exists protect_winner_at_r numeric(10,6),
  add column if not exists trail_remainder boolean not null default false;

update public.paper_bot_orders
set take_profit_price=122.3105915401,
    take_profit_fraction=0.25,
    take_profit_r=1.75,
    protect_winner_at_r=1.00,
    trail_remainder=true,
    updated_at=now()
where client_order_id='chb-div-v1-mtg20261003-solwknd01';

update public.paper_bot_positions
set take_profit_price=122.3105915401,
    take_profit_fraction=0.25,
    take_profit_r=1.75,
    protect_winner_at_r=1.00,
    trail_remainder=true,
    updated_at=now()
where bot_id='default-diverse' and symbol='SOL/USD';

update public.paper_bot_orders
set take_profit_price=case symbol
      when 'QQQ' then 812.052744
      when 'NVDA' then 272.970147
      when 'MSFT' then 588.821666
      else take_profit_price end,
    take_profit_fraction=0.50,
    take_profit_r=2.00,
    protect_winner_at_r=1.00,
    trail_remainder=true,
    updated_at=now()
where bot_id='three-trade-weekly-swing-100'
  and status='prepared'
  and symbol in ('QQQ','NVDA','MSFT');
