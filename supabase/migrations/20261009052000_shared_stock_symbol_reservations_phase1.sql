-- Shared, durable PAPER stock ownership reservation: phase 1 (Pulse + Fuse).
-- No live broker activity is initiated by this migration. Reservations are
-- permanently held until independently audited/reconciled; do not use TTLs to
-- infer a canceled or still-physically-held Alpaca position is free.
CREATE TABLE IF NOT EXISTS public.paper_stock_symbol_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9.]{0,15}$'),
  bot_id text NOT NULL REFERENCES public.paper_bot_ledgers(bot_id),
  client_order_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT paper_stock_symbol_release_consistency CHECK (
    (status='active' AND released_at IS NULL) OR
    (status='released' AND released_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS paper_stock_symbol_active_symbol
  ON public.paper_stock_symbol_reservations(symbol) WHERE status='active';
CREATE INDEX IF NOT EXISTS paper_stock_symbol_bot_idx
  ON public.paper_stock_symbol_reservations(bot_id,status);
ALTER TABLE public.paper_stock_symbol_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_stock_symbol_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paper_stock_symbol_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.paper_stock_symbol_claim(
  p_bot_id text,p_symbol text,p_client_order_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_tag text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN false; END IF;
  IF p_bot_id NOT IN ('momentum-breakout-100','penny-volatility-day-100')
     OR p_symbol IS NULL OR p_symbol !~ '^[A-Z][A-Z0-9.]{0,15}$'
     OR p_client_order_id IS NULL OR length(p_client_order_id)>128 THEN
    RETURN false;
  END IF;
  SELECT broker_tag INTO v_tag
  FROM public.paper_bot_ledgers
  WHERE bot_id=p_bot_id AND status='active';
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
-- Deliberately NO release endpoint yet. An active reservation is stronger
-- than the broker's temporary open-order state and cannot be reused by a
-- timed-out or rejected-but-uncertain order without a follow-up audit.
