update public.paper_bot_ledgers
set starting_cash=100,cash=100,equity=100,realized_pl=0,unrealized_pl=0,buying_power=100,peak_equity=100,current_drawdown_pct=0,
  open_planned_risk_pct=0,correlated_risk_pct=0,daily_realized_loss_pct=0,weekly_drawdown_pct=0,source='virtual-ledger',
  metadata=metadata||jsonb_build_object('challengeStartingCash',100,'brokerAccountIsExecutionVenueOnly',true,'brokerAccountEquityIsNotBotEquity',true,'tradeAttributionRequired',true),
  updated_at=now()
where not exists (
  select 1 from public.paper_bot_journal j
  where j.bot_id=paper_bot_ledgers.bot_id and j.event_type in ('submitted','filled','partial_exit','closed')
);

delete from public.paper_bot_equity_history
where bot_id in (
  select bot_id from public.paper_bot_ledgers
  where not exists (
    select 1 from public.paper_bot_journal j
    where j.bot_id=paper_bot_ledgers.bot_id and j.event_type in ('submitted','filled','partial_exit','closed')
  )
);

insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
select bot_id,date_trunc('minute',now()),now(),equity,cash,realized_pl,unrealized_pl from public.paper_bot_ledgers
on conflict (bot_id,bucket_minute) do update
set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;
