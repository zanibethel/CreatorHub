insert into public.paper_bot_ledgers(
  bot_id,display_name,status,strategy_id,strategy_version,
  starting_cash,cash,equity,realized_pl,unrealized_pl,buying_power,
  peak_equity,current_drawdown_pct,open_planned_risk_pct,
  correlated_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,
  source,broker_tag,metadata
) values (
  'weekend-crypto-day-100',
  '$100 Weekend Crypto Day Bot',
  'active',
  'weekend-crypto-day-v1',
  1,
  100,100,100,0,0,100,
  100,0,0,0,0,0,
  'virtual',
  'wkd',
  '{
    "challenge":"$100 weekend crypto day-trading proof of concept",
    "executionVenue":"alpaca-paper",
    "executionEnabled":false,
    "executionMode":"paper-crypto",
    "liveMoneyEnabled":false,
    "weekendOnly":true,
    "timezone":"America/Chicago",
    "maxNewTradesPerDay":3,
    "maxOpenPositions":1,
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
