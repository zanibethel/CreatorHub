-- BigOrders PAPER stock reservation operator-release groundwork.
-- Coil is research-only / execution disabled, but future executor requests
-- must participate in the same physical-symbol ownership lock.
CREATE OR REPLACE FUNCTION public.paper_stock_symbol_claim(
  p_bot_id text,p_symbol text,p_client_order_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_tag text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN false; END IF;
  IF p_bot_id NOT IN ('momentum-breakout-100','penny-volatility-day-100','default-diverse','three-trade-weekly-swing-100','squeeze-breakout-100')
     OR p_symbol IS NULL OR p_symbol !~ '^[A-Z][A-Z0-9.]{0,15}$'
     OR p_client_order_id IS NULL OR length(p_client_order_id)>128 THEN
    RETURN false;
  END IF;
  SELECT broker_tag INTO v_tag
  FROM public.paper_bot_ledgers
  WHERE bot_id=p_bot_id AND status='active';
  -- Coil is readiness-only today. A future executor may claim only after
  -- its separate risk/execution approval explicitly arms the bot.
  IF p_bot_id='squeeze-breakout-100' AND NOT EXISTS(
    SELECT 1 FROM public.paper_bot_ledgers
      WHERE bot_id=p_bot_id AND status='active'
        AND metadata->>'executionEnabled'='true'
  ) THEN RETURN false; END IF;
  IF v_tag IS NULL OR p_client_order_id !~
     ('^chb-'||v_tag||'-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$') THEN
    RETURN false;
  END IF;
  -- All participating bot claims serialize on identical advisory lock keys.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paper-stock:'||p_symbol,0)
  );
  -- Preserve any existing ownership indefinitely until broker and ledger
  -- positions have been independently reconciled and explicitly released.
  IF EXISTS (SELECT 1 FROM public.paper_stock_symbol_reservations
             WHERE symbol=p_symbol AND status='active')
     OR EXISTS (SELECT 1 FROM public.paper_stock_symbol_reservations
                WHERE client_order_id=p_client_order_id)
     OR EXISTS (SELECT 1 FROM public.paper_bot_positions
                WHERE symbol=p_symbol AND quantity>0)
     OR EXISTS (SELECT 1 FROM public.paper_bot_orders
                WHERE symbol=p_symbol AND asset_class IN ('stock','etf')
                AND client_order_id<>p_client_order_id
                AND (
                  status IN ('prepared','submitted','accepted','pending_new','partially_filled')
                  OR (status='filled' AND created_at > pg_catalog.now()-interval '2 minutes')
                ))
  THEN RETURN false; END IF;
  INSERT INTO public.paper_stock_symbol_reservations
    (symbol,bot_id,client_order_id)
  VALUES (p_symbol,p_bot_id,p_client_order_id);
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.paper_stock_symbol_claim(text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_stock_symbol_claim(text,text,text)
 TO service_role;

-- Every release writes an audit record within the same database transaction.
CREATE TABLE IF NOT EXISTS public.paper_stock_symbol_release_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.paper_stock_symbol_reservations(reservation_id),
  symbol text NOT NULL,
  bot_id text NOT NULL,
  client_order_id text NOT NULL,
  source text NOT NULL,
  broker_checked_at timestamptz NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_stock_symbol_release_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_stock_symbol_release_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_stock_symbol_release_audit TO service_role;

-- The service role may release ONLY with fresh independent broker evidence
-- from the private PAPER endpoint, a terminal local order and zero virtual
-- shares or unresolved stock orders for any bot. This function has NO cron.
CREATE OR REPLACE FUNCTION public.paper_stock_symbol_release_verified(
 p_reservation_id uuid,
 p_client_order_id text,
 p_proof jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_owner public.paper_stock_symbol_reservations%rowtype;
DECLARE v_time timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR
    p_proof IS NULL OR jsonb_typeof(p_proof)<>'object' OR
    coalesce(p_proof->>'source','')<>'alpaca-paper-independent-audit-v1' OR
    coalesce(p_proof->>'brokerHost','')<>'paper-api.alpaca.markets' OR
    coalesce(p_proof->>'brokerMarketOpen','')<>'false' OR
    coalesce(p_proof->>'brokerPositionsClear','')<>'true' OR
    coalesce(p_proof->>'brokerOpenOrdersClear','')<>'true' OR
    coalesce(p_proof->>'brokerParentTerminal','')<>'true' OR
    coalesce(p_proof->>'operatorConfirmed','')<>'true'
 THEN RETURN false; END IF;
 BEGIN
  v_time:=(p_proof->>'checkedAt')::timestamptz;
 EXCEPTION WHEN others THEN RETURN false; END;
 IF v_time IS NULL OR v_time>pg_catalog.now()+interval '2 seconds'
   OR v_time<pg_catalog.now()-interval '30 seconds' THEN RETURN false; END IF;
 SELECT * INTO v_owner
  FROM public.paper_stock_symbol_reservations
  WHERE reservation_id=p_reservation_id
    AND client_order_id=p_client_order_id
    AND status='active';
 IF NOT FOUND OR v_owner.symbol IS DISTINCT FROM p_proof->>'symbol'
   OR v_owner.bot_id IS DISTINCT FROM p_proof->>'botId'
   OR v_owner.client_order_id IS DISTINCT FROM p_proof->>'clientOrderId'
 THEN RETURN false; END IF;
 -- Same lock order as admission: global symbol lock first, row lock second.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('paper-stock:'||v_owner.symbol,0)
 );
 SELECT * INTO v_owner
  FROM public.paper_stock_symbol_reservations
  WHERE reservation_id=p_reservation_id
    AND client_order_id=p_client_order_id
    AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Any unapplied physical fill could still produce newly held virtual shares
 -- on the next reporting cycle. Never unlock before fill reconciliation.
 IF EXISTS(SELECT 1 FROM public.paper_bot_broker_fills f
           WHERE f.symbol=v_owner.symbol AND f.ledger_applied_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.paper_report_state r
           WHERE r.report_key='main' AND r.status='ready'
             AND r.last_attempt_at>pg_catalog.now()-interval '2 minutes')
 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.paper_bot_positions p
           WHERE p.symbol=v_owner.symbol AND p.asset_class IN ('stock','etf')
             AND p.quantity<>0)
   OR EXISTS(SELECT 1 FROM public.paper_bot_orders o
       WHERE o.symbol=v_owner.symbol AND o.asset_class IN ('stock','etf')
         AND o.status NOT IN ('filled','canceled','rejected','expired','closed'))
   OR NOT EXISTS(SELECT 1 FROM public.paper_bot_orders o
       WHERE o.client_order_id=v_owner.client_order_id
         AND o.bot_id=v_owner.bot_id AND o.symbol=v_owner.symbol
         AND o.asset_class IN ('stock','etf')
         AND o.side='buy' AND o.status IN
           ('filled','canceled','rejected','expired','closed'))
 THEN RETURN false; END IF;
 UPDATE public.paper_stock_symbol_reservations
    SET status='released',released_at=pg_catalog.now()
    WHERE reservation_id=v_owner.reservation_id AND status='active'
      AND client_order_id=v_owner.client_order_id;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.paper_stock_symbol_release_audit
   (reservation_id,symbol,bot_id,client_order_id,source,broker_checked_at)
 VALUES(v_owner.reservation_id,v_owner.symbol,v_owner.bot_id,
   v_owner.client_order_id,'alpaca-paper-independent-audit-v1',v_time);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.paper_stock_symbol_release_verified(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_stock_symbol_release_verified(uuid,text,jsonb)
 TO service_role;
