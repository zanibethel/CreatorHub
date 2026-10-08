-- Add isolated virtual ledgers for the two coverage-gap bots identified from refusal/missed-opportunity review.
-- Pulse owns fast stock momentum setups that do not belong in the multi-day Swing strategy.
-- Spark studies the early 60-79 crypto readiness tier before slower confirmation graduates a setup to Flash.

insert into public.paper_bot_ledgers (
  bot_id, display_name, status, strategy_id, strategy_version,
  starting_cash, cash, equity, realized_pl, unrealized_pl, buying_power, peak_equity,
  current_drawdown_pct, open_planned_risk_pct, correlated_risk_pct,
  daily_realized_loss_pct, weekly_drawdown_pct, source, broker_tag, metadata, pool_usage
) values
(
  'momentum-breakout-100','Pulse — $100 Stock Momentum Breakout Bot','active','stock-momentum-breakout-v1',1,
  100,100,100,0,0,100,100,0,0,0,0,0,'virtual','pls',
  '{"challenge":"$100 intraday stock momentum breakout bot","capitalPlanId":"main","capitalPoolUsd":100,"capitalPoolIndex":7,"programCapitalUsd":1000,"capitalPoolReserved":true,"executionVenue":"alpaca-paper","executionMode":"paper-bracket","executionEnabled":false,"liveMoneyEnabled":false,"maxOpenPositions":2,"maxNewTradesPerDay":3,"riskPerTradePct":0.5,"maximumPositionAllocationPct":25,"prospectScannerRequired":true,"tradeAttributionRequired":true,"brokerAccountEquityIsNotBotEquity":true,"brokerAccountIsExecutionVenueOnly":true}'::jsonb,
  '{"day":0,"multi-day":0,"multi-week":0}'::jsonb
),
(
  'crypto-ignition-100','Spark — $100 Crypto Ignition Bot','active','crypto-ignition-v1',1,
  100,100,100,0,0,100,100,0,0,0,0,0,'virtual','spk',
  '{"challenge":"$100 early crypto ignition research bot","capitalPlanId":"main","capitalPoolUsd":100,"capitalPoolIndex":8,"programCapitalUsd":1000,"capitalPoolReserved":true,"executionVenue":"alpaca-paper","executionMode":"paper-crypto-ignition","executionEnabled":false,"liveMoneyEnabled":false,"maxOpenPositions":1,"maxNewTradesPerDay":3,"riskPerTradePct":0.35,"maximumPositionAllocationPct":20,"sourceScoreTier":[60,79],"graduationBot":"weekend-crypto-day-100","tradeAttributionRequired":true,"brokerAccountEquityIsNotBotEquity":true,"brokerAccountIsExecutionVenueOnly":true}'::jsonb,
  '{"day":0,"multi-day":0,"multi-week":0}'::jsonb
)
on conflict (bot_id) do update set
  display_name=excluded.display_name,
  status=excluded.status,
  strategy_id=excluded.strategy_id,
  strategy_version=excluded.strategy_version,
  broker_tag=excluded.broker_tag,
  metadata=public.paper_bot_ledgers.metadata || excluded.metadata,
  updated_at=now();
