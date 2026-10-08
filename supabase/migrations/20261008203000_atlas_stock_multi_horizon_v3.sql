-- Record Atlas stock execution mode after enabling rolling protection for funded stock horizons.
UPDATE public.paper_bot_ledgers
SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
  'executionEnabled',true,
  'liveMoneyEnabled',false,
  'atlasExecutionMode','fractional-stock-multi-horizon-v3',
  'stockProtectionMode','rolling-day-simple-stop'
), updated_at=now()
WHERE bot_id='default-diverse';
