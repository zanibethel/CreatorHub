-- Preserve broker-reported terminal timestamps privately and expose an
-- evidence-only OCO risk report. Does NOT alter pilots, orders, execution
-- permissions, virtual ledgers, or any existing broker reconciliation.
CREATE OR REPLACE FUNCTION public.paper_bot_record_order_lifecycle_evidence(
  p_orders jsonb, p_collected_at timestamptz
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE v_updated integer := 0;
BEGIN
  IF jsonb_typeof(coalesce(p_orders,'[]'::jsonb)) <> 'array'
     OR p_collected_at IS NULL THEN
    RAISE EXCEPTION 'Invalid broker lifecycle evidence payload';
  END IF;
  WITH incoming AS (
    SELECT DISTINCT ON (left(item->>'brokerOrderId',80))
      left(item->>'brokerOrderId',80) AS broker_id,
      left(item->>'clientOrderId',128) AS client_id,
      left(item->>'attributionClientOrderId',128) AS attributed_client,
      nullif(left(item->>'canceledAt',40),'') AS canceled_at,
      nullif(left(item->>'replacedAt',40),'') AS replaced_at,
      nullif(left(item->>'updatedAt',40),'') AS updated_at
    FROM jsonb_array_elements(p_orders) AS item
    WHERE coalesce(item->>'brokerOrderId','') <> ''
      AND coalesce(item->>'clientOrderId','') <> ''
      AND coalesce(item->>'attributionClientOrderId','') <> ''
      AND (
        coalesce(item->>'canceledAt','') <> ''
        OR coalesce(item->>'replacedAt','') <> ''
        OR coalesce(item->>'updatedAt','') <> ''
      )
    ORDER BY left(item->>'brokerOrderId',80)
  )
  UPDATE public.paper_bot_broker_orders AS o
  SET metadata = coalesce(o.metadata,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'brokerCanceledAt',i.canceled_at,
         'brokerReplacedAt',i.replaced_at,
         'brokerUpdatedAt',i.updated_at,
         'lifecycleObservedAt',p_collected_at
       ))
  FROM incoming i
  WHERE o.broker_order_id=i.broker_id
    AND o.client_order_id=i.client_id
    AND o.metadata->>'attributionClientOrderId'=i.attributed_client
    AND o.metadata->>'source'='alpaca-paper';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  RETURN v_updated;
END $fn$;

REVOKE ALL ON FUNCTION public.paper_bot_record_order_lifecycle_evidence(jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_bot_record_order_lifecycle_evidence(jsonb,timestamptz)
  TO service_role;

-- Service-role-only retrospective evidence. This reports a *potential*
-- unprotected residual interval; REST state/timestamps cannot establish
-- whether a broker used a private internal protection mechanism.
CREATE OR REPLACE FUNCTION public.paper_bot_stock_oco_gap_audit(p_bot_id text DEFAULT NULL)
RETURNS TABLE (
  bot_id text, symbol text, parent_broker_order_id text,
  stop_broker_order_id text, target_broker_order_id text,
  stop_canceled_at timestamptz, residual_shares_at_cancellation numeric,
  last_target_fill_at timestamptz, potential_gap_ms numeric,
  assessment text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $fn$
  WITH stopped AS (
    SELECT s.bot_id,s.symbol,s.broker_order_id AS stop_id,
      s.metadata->>'parentBrokerOrderId' AS parent_id,
      (s.metadata->>'brokerCanceledAt')::timestamptz AS canceled_at
    FROM public.paper_bot_broker_orders s
    WHERE s.asset_class='stock' AND s.side='sell'
      AND s.order_type IN ('stop','stop_limit')
      AND s.status IN ('canceled','cancelled')
      AND s.metadata->>'brokerCanceledAt' IS NOT NULL
      AND (p_bot_id IS NULL OR s.bot_id=p_bot_id)
      AND s.metadata->>'parentBrokerOrderId' IS NOT NULL
  ), candidates AS (
    SELECT s.bot_id,s.symbol,s.parent_id,s.stop_id,t.broker_order_id AS target_id,
      s.canceled_at,t.quantity AS target_qty,
      coalesce((SELECT sum(f.quantity)
        FROM public.paper_bot_broker_fills f
        WHERE f.broker_order_id=t.broker_order_id
          AND f.bot_id=s.bot_id
          AND f.side='sell'
          AND f.transaction_time<=s.canceled_at),0) AS sold_before_cancel,
      (SELECT max(f.transaction_time)
        FROM public.paper_bot_broker_fills f
        WHERE f.broker_order_id=t.broker_order_id
          AND f.bot_id=s.bot_id
          AND f.side='sell') AS final_fill
    FROM stopped s
    JOIN public.paper_bot_broker_orders t
      ON t.bot_id=s.bot_id AND t.symbol=s.symbol
      AND t.metadata->>'parentBrokerOrderId'=s.parent_id
      AND t.broker_order_id<>s.stop_id
      AND t.order_type='limit' AND t.side='sell'
      AND t.order_class='bracket' AND t.quantity>0
    JOIN public.paper_bot_broker_orders p
      ON p.broker_order_id=s.parent_id
      AND p.bot_id=s.bot_id AND p.symbol=s.symbol
      AND p.side='buy' AND p.order_class='bracket'
  )
  SELECT c.bot_id,c.symbol,c.parent_id,c.stop_id,c.target_id,c.canceled_at,
    c.target_qty-c.sold_before_cancel,c.final_fill,
    round(extract(epoch FROM (c.final_fill-c.canceled_at))::numeric*1000,3),
    'possible_unprotected_residual_interval_broker_internal_state_unknown'::text
  FROM candidates c
  WHERE c.target_qty>c.sold_before_cancel
    AND c.final_fill>c.canceled_at;
$fn$;

REVOKE ALL ON FUNCTION public.paper_bot_stock_oco_gap_audit(text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_bot_stock_oco_gap_audit(text)
  TO service_role;
