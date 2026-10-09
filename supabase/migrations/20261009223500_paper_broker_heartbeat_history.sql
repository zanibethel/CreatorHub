-- Private, low-overhead history of genuine accepted PAPER monitor heartbeats.
-- The Samsung and existing ingest Edge Function do not change.
-- This is operational telemetry only; never broker orders, fills or bot ledgers.
CREATE TABLE public.paper_broker_trade_stream_heartbeat_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_name text NOT NULL CHECK (stream_name='alpaca-paper-trade_updates'),
  observed_at timestamptz NOT NULL,
  previous_heartbeat_at timestamptz,
  gap_seconds numeric(12,3),
  connected boolean NOT NULL,
  session_changed boolean NOT NULL,
  connection_transition boolean NOT NULL,
  worker_session_id text,
  reconnect_count integer NOT NULL,
  total_recorded_events bigint NOT NULL,
  CONSTRAINT paper_broker_heartbeat_gap_nonnegative
    CHECK (gap_seconds IS NULL OR gap_seconds >= 0)
);
CREATE INDEX paper_broker_heartbeat_history_time_idx
  ON public.paper_broker_trade_stream_heartbeat_history
  (stream_name,observed_at DESC);

-- These rows belong to the same privileged trust boundary as broker stream
-- status; never expose monitoring internals in authenticated/public clients.
ALTER TABLE public.paper_broker_trade_stream_heartbeat_history
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_broker_trade_stream_heartbeat_history
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.paper_broker_trade_stream_heartbeat_history
  TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.paper_broker_trade_stream_heartbeat_history_id_seq
  TO service_role;

-- Trigger on the already-authenticated, service-role-only ingest RPC update.
-- Private evidence logging is best-effort: failure MUST NOT roll back the
-- existing accepted broker event batch or its canonical health heartbeat.
CREATE FUNCTION public.paper_broker_log_accepted_heartbeat()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
  IF NEW.last_heartbeat_at IS DISTINCT FROM OLD.last_heartbeat_at THEN
    BEGIN
      INSERT INTO public.paper_broker_trade_stream_heartbeat_history (
        stream_name,observed_at,previous_heartbeat_at,gap_seconds,
        connected,session_changed,connection_transition,
        worker_session_id,reconnect_count,total_recorded_events
      ) VALUES (
        NEW.stream_name,NEW.last_heartbeat_at,OLD.last_heartbeat_at,
        CASE WHEN OLD.last_heartbeat_at IS NULL THEN NULL ELSE
          round(extract(epoch FROM (NEW.last_heartbeat_at-OLD.last_heartbeat_at))::numeric,3)
        END,
        NEW.connected,
        (OLD.worker_session_id IS DISTINCT FROM NEW.worker_session_id),
        (OLD.connected IS DISTINCT FROM NEW.connected),
        NEW.worker_session_id,NEW.reconnect_count,NEW.total_recorded_events
      );

      -- One purge per active day; no additional cron or daily external job.
      -- If monitoring stops, no rows are added and storage cannot grow.
      IF date_trunc('day',NEW.last_heartbeat_at) IS DISTINCT FROM
         date_trunc('day',OLD.last_heartbeat_at) THEN
        DELETE FROM public.paper_broker_trade_stream_heartbeat_history
        WHERE observed_at < NEW.last_heartbeat_at - interval '14 days';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Never break the core evidence ingestion path for optional telemetry.
      NULL;
    END;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.paper_broker_log_accepted_heartbeat()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paper_broker_log_accepted_heartbeat()
  TO service_role;

CREATE TRIGGER paper_broker_log_accepted_heartbeat_after
AFTER UPDATE OF last_heartbeat_at
ON public.paper_broker_trade_stream_health
FOR EACH ROW
EXECUTE FUNCTION public.paper_broker_log_accepted_heartbeat();
