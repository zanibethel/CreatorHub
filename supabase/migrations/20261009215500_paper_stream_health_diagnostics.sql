-- PAPER monitor diagnostics: preserve actual stream connection transitions.
-- Additive, service-role-only health information. Never changes orders, fills or ledgers.
-- Existing connected clients can continue posting their original envelope.
CREATE OR REPLACE FUNCTION public.paper_broker_record_trade_updates(
  p_events jsonb,
  p_worker_session_id text,
  p_connected boolean,
  p_reconnect_count integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
  v_inserted integer := 0;
  v_max_event timestamptz;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' OR
     jsonb_array_length(p_events)>50 OR
     length(p_events::text)>250000 OR
     p_worker_session_id IS NULL OR p_worker_session_id !~ '^[a-f0-9-]{36}$' OR
     p_connected IS NULL OR
     p_reconnect_count IS NULL OR
     p_reconnect_count<0 OR p_reconnect_count>10000000 THEN
    RAISE EXCEPTION 'Invalid PAPER stream ingest envelope';
  END IF;
  v_count:=jsonb_array_length(p_events);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS e(item)
    WHERE jsonb_typeof(item)<>'object'
      OR coalesce(item->>'eventHash','') !~ '^[a-f0-9]{64}$'
      OR length(coalesce(item->>'brokerOrderId','')) NOT BETWEEN 5 AND 80
      OR length(coalesce(item->>'symbol','')) NOT BETWEEN 1 AND 32
      OR length(coalesce(item->>'event','')) NOT BETWEEN 2 AND 40
      OR length(coalesce(item->>'clientOrderId',''))>128
      OR length(coalesce(item->>'eventTimestampRaw',''))>45
      OR length(coalesce(item->>'orderUpdatedAtRaw',''))>45
      OR coalesce(jsonb_typeof(item->'details'),'object')<>'object'
  ) THEN
    RAISE EXCEPTION 'Invalid PAPER stream event';
  END IF;

  INSERT INTO public.paper_broker_trade_updates(
    event_hash,broker_order_id,client_order_id,symbol,event_name,event_at,
    event_timestamp_raw,order_updated_at_raw,event_side,broker_status,
    order_class,order_type,order_quantity,cumulative_fill_quantity,
    event_fill_quantity,event_fill_price,position_quantity,execution_id,
    broker_event_id,details
  )
  SELECT
    item->>'eventHash',item->>'brokerOrderId',nullif(item->>'clientOrderId',''),
    item->>'symbol',item->>'event',
    nullif(item->>'eventTimestampRaw','')::timestamptz,
    nullif(item->>'eventTimestampRaw',''),
    nullif(item->>'orderUpdatedAtRaw',''),
    nullif(item->>'side',''),nullif(item->>'status',''),
    nullif(item->>'orderClass',''),nullif(item->>'orderType',''),
    nullif(item->>'orderQuantity','')::numeric,
    nullif(item->>'cumulativeFillQuantity','')::numeric,
    nullif(item->>'eventFillQuantity','')::numeric,
    nullif(item->>'eventFillPrice','')::numeric,
    nullif(item->>'positionQuantity','')::numeric,
    nullif(item->>'executionId',''),nullif(item->>'brokerEventId',''),
    coalesce(item->'details','{}'::jsonb)
  FROM jsonb_array_elements(p_events) AS e(item)
  WHERE true
  ON CONFLICT (event_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT max(event_at) INTO v_max_event
  FROM public.paper_broker_trade_updates
  WHERE event_hash IN (SELECT item->>'eventHash' FROM jsonb_array_elements(p_events) AS e(item));

  UPDATE public.paper_broker_trade_stream_health
  SET worker_session_id=p_worker_session_id,
      connected=p_connected,
      last_heartbeat_at=now(),
      last_event_at=coalesce(greatest(last_event_at,v_max_event),last_event_at,v_max_event),
      last_connected_at=CASE WHEN p_connected AND (NOT connected OR worker_session_id IS DISTINCT FROM p_worker_session_id) THEN now() ELSE last_connected_at END,
      reconnect_count=p_reconnect_count,
      total_recorded_events=total_recorded_events+v_inserted,
      updated_at=now()
  WHERE stream_name='alpaca-paper-trade_updates';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAPER trade stream health row not found';
  END IF;
  RETURN jsonb_build_object('accepted',v_count,'inserted',v_inserted,'duplicates',v_count-v_inserted);
END $fn$;

-- Preserve the original view columns in order; append diagnostics for private operators.
CREATE OR REPLACE VIEW public.paper_broker_trade_stream_status
WITH (security_invoker=true) AS
SELECT stream_name,worker_session_id,connected,
  last_heartbeat_at,last_event_at,last_connected_at,reconnect_count,
  total_recorded_events,
  (connected AND last_heartbeat_at>now()-interval '75 seconds') AS recently_connected,
  (SELECT count(*) FROM public.paper_broker_trade_updates) AS stored_event_count,
  now() AS evaluated_at,
  round(extract(epoch FROM (now()-last_heartbeat_at))::numeric,2) AS heartbeat_age_seconds,
  CASE
    WHEN last_heartbeat_at IS NULL THEN 'never_received'
    WHEN last_heartbeat_at<=now()-interval '75 seconds' THEN 'stale_heartbeat'
    WHEN NOT connected THEN 'broker_disconnected'
    ELSE 'connected_and_delivering'
  END AS monitor_state
FROM public.paper_broker_trade_stream_health;
REVOKE ALL ON public.paper_broker_trade_stream_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_broker_trade_stream_status TO service_role;
