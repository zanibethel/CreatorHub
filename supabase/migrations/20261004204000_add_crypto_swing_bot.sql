insert into public.paper_bot_ledgers(
  bot_id,display_name,status,strategy_id,strategy_version,
  starting_cash,cash,equity,realized_pl,unrealized_pl,buying_power,
  peak_equity,current_drawdown_pct,open_planned_risk_pct,
  correlated_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,
  source,broker_tag,metadata
) values (
  'crypto-swing-100',
  '$100 Crypto Swing Bot',
  'active',
  'crypto-swing-v1',
  1,
  100,100,100,0,0,100,
  100,0,0,0,0,0,
  'virtual',
  'csw',
  '{
    "challenge":"$100 selective 1-7 day crypto swing research bot",
    "executionVenue":"alpaca-paper",
    "executionEnabled":false,
    "executionMode":"paper-crypto-swing",
    "liveMoneyEnabled":false,
    "maxNewTradesPerWeek":3,
    "maxOpenPositions":2,
    "intendedHoldingDays":[1,7],
    "prospectScannerRequired":true,
    "challengeStartingCash":100,
    "tradeAttributionRequired":true,
    "brokerAccountEquityIsNotBotEquity":true,
    "brokerAccountIsExecutionVenueOnly":true
  }'::jsonb
)
on conflict (bot_id) do update set
  display_name=excluded.display_name,
  status=excluded.status,
  strategy_id=excluded.strategy_id,
  strategy_version=excluded.strategy_version,
  broker_tag=excluded.broker_tag,
  metadata=public.paper_bot_ledgers.metadata || excluded.metadata,
  updated_at=now();

insert into public.paper_bot_equity_history(
  bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl
)
select
  bot_id,date_trunc('minute',now()),now(),equity,cash,realized_pl,unrealized_pl
from public.paper_bot_ledgers
where bot_id='crypto-swing-100'
on conflict (bot_id,bucket_minute) do update
set collected_at=excluded.collected_at,
    equity=excluded.equity,
    cash=excluded.cash,
    realized_pl=excluded.realized_pl,
    unrealized_pl=excluded.unrealized_pl;
