-- Append-only, service-only Alpaca PAPER trade_updates event capture.
-- This is broker evidence, never a substitute for the existing fill/ledger RPC.
CREATE TABLE IF NOT EXISTS public.paper_broker_trade_updates (
  event_hash text PRIMARY KEY CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  broker_order_id text NOT NULL CHECK (length(broker_order_id) BETWEEN 5 AND 80),
  client_order_id text,
  symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 32),
  event_name text NOT NULL CHECK (length(event_name) BETWEEN 2 AND 40),
  event_at timestamptz,
  event_timestamp_raw text,
  order_updated_at_raw text,
  event_side text,
  broker_status text,
  order_class text,
  order_type text,
  order_quantity numeric,
  cumulative_fill_quantity numeric,
  event_fill_quantity numeric,
  event_fill_price numeric,
  position_quantity numeric,
  execution_id text,
  broker_event_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paper_trade_updates_order_time
  ON public.paper_broker_trade_updates (broker_order_id,event_at,first_received_at);
CREATE INDEX IF NOT EXISTS idx_paper_trade_updates_symbol_time
  ON public.paper_broker_trade_updates (symbol,first_received_at DESC);

CREATE TABLE IF NOT EXISTS public.paper_broker_trade_stream_health (
  stream_name text PRIMARY KEY CHECK (stream_name='alpaca-paper-trade_updates'),
  worker_session_id text,
  connected boolean NOT NULL DEFAULT false,
  last_heartbeat_at timestamptz,
  last_event_at timestamptz,
  last_connected_at timestamptz,
  reconnect_count integer NOT NULL DEFAULT 0,
  total_recorded_events bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.paper_broker_trade_stream_health(stream_name)
VALUES ('alpaca-paper-trade_updates')
ON CONFLICT (stream_name) DO NOTHING;

-- No public, user, or app-query access to private broker event history.
ALTER TABLE public.paper_broker_trade_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_broker_trade_stream_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_broker_trade_updates FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.paper_broker_trade_stream_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.paper_broker_trade_updates TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.paper_broker_trade_stream_health TO service_role;

-- At-most 50 events per transaction. A duplicate replay never changes the
-- event or its receipt time. The broker fills collector continues separately.
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
     p_worker_session_id !~ '^[a-f0-9-]{36}$' OR
     p_connected IS NULL OR
     p_reconnect_count IS NULL OR
     p_reconnect_count<0 OR p_reconnect_count>10000000 THEN
    RAISE EXCEPTION 'Invalid PAPER stream ingest envelope';
  END IF;
  v_count:=jsonb_array_length(p_events);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS event
    WHERE jsonb_typeof(event)<>'object'
      OR coalesce(event->>'eventHash','') !~ '^[a-f0-9]{64}$'
      OR length(coalesce(event->>'brokerOrderId','')) NOT BETWEEN 5 AND 80
      OR length(coalesce(event->>'symbol','')) NOT BETWEEN 1 AND 32
      OR length(coalesce(event->>'event','')) NOT BETWEEN 2 AND 40
      OR length(coalesce(event->>'clientOrderId',''))>128
      OR length(coalesce(event->>'eventTimestampRaw',''))>45
      OR length(coalesce(event->>'orderUpdatedAtRaw',''))>45
      OR coalesce(jsonb_typeof(event->'details'),'object')<>'object'
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
  FROM jsonb_array_elements(p_events) AS item
  ON CONFLICT (event_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT max(event_at) INTO v_max_event
  FROM public.paper_broker_trade_updates
  WHERE event_hash IN (SELECT item->>'eventHash' FROM jsonb_array_elements(p_events) AS item);

  UPDATE public.paper_broker_trade_stream_health
  SET worker_session_id=p_worker_session_id,
      connected=p_connected,
      last_heartbeat_at=now(),
      last_event_at=coalesce(greatest(last_event_at,v_max_event),last_event_at,v_max_event),
      last_connected_at=CASE WHEN p_connected THEN now() ELSE last_connected_at END,
      reconnect_count=p_reconnect_count,
      total_recorded_events=total_recorded_events+v_inserted,
      updated_at=now()
  WHERE stream_name='alpaca-paper-trade_updates';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAPER trade stream health row not found';
  END IF;
  RETURN jsonb_build_object('accepted',v_count,'inserted',v_inserted,'duplicates',v_count-v_inserted);
END $fn$;
REVOKE ALL ON FUNCTION public.paper_broker_record_trade_updates(jsonb,text,boolean,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_broker_record_trade_updates(jsonb,text,boolean,integer)
  TO service_role;

-- Read-only audit view with explicit staleness. A healthy HTTP ingest is
-- not evidence that the WebSocket had uninterrupted coverage.
CREATE OR REPLACE VIEW public.paper_broker_trade_stream_status
WITH (security_invoker=true) AS
SELECT stream_name,worker_session_id,connected,
  last_heartbeat_at,last_event_at,last_connected_at,reconnect_count,
  total_recorded_events,
  (connected AND last_heartbeat_at>now()-interval '75 seconds') AS recently_connected,
  (SELECT count(*) FROM public.paper_broker_trade_updates) AS stored_event_count
FROM public.paper_broker_trade_stream_health;
REVOKE ALL ON public.paper_broker_trade_stream_status FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_broker_trade_stream_status TO service_role;
