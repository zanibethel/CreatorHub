-- Actual deployed read-only audit view definition, reconstructed from pg_get_viewdef.
-- This migration does not modify bot strategy, cash, broker permissions or order routing.
CREATE OR REPLACE VIEW public.paper_bot_performance_audit_v1
WITH (security_invoker=true) AS
 WITH journal AS (
         SELECT paper_bot_journal.bot_id,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '24:00:00'::interval)) AS events_24h,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval)) AS events_7d,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '24:00:00'::interval) AND paper_bot_journal.event_type = 'candidate'::text) AS candidate_checks_24h,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval) AND paper_bot_journal.event_type = 'candidate'::text) AS candidate_checks_7d,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval) AND paper_bot_journal.event_type = 'rejected'::text) AS rejections_7d,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval) AND paper_bot_journal.event_type = 'authorized'::text) AS authorizations_7d,
            count(*) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval) AND paper_bot_journal.event_type = 'system'::text) AS system_checks_7d,
            count(DISTINCT paper_bot_journal.symbol) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '24:00:00'::interval) AND paper_bot_journal.symbol IS NOT NULL) AS distinct_symbols_24h,
            count(DISTINCT paper_bot_journal.symbol) FILTER (WHERE paper_bot_journal.occurred_at >= (now() - '7 days'::interval) AND paper_bot_journal.symbol IS NOT NULL) AS distinct_symbols_7d,
            max(paper_bot_journal.occurred_at) AS latest_journal_at,
            max(paper_bot_journal.occurred_at) FILTER (WHERE paper_bot_journal.event_type = 'candidate'::text) AS latest_candidate_at
           FROM paper_bot_journal
          GROUP BY paper_bot_journal.bot_id
        ), trades AS (
         SELECT paper_bot_trade_metrics.bot_id,
            count(*) FILTER (WHERE paper_bot_trade_metrics.status = 'closed'::text) AS closed_trades,
            count(*) FILTER (WHERE paper_bot_trade_metrics.status = 'closed'::text AND paper_bot_trade_metrics.realized_pl > 0::numeric) AS winning_trades,
            count(*) FILTER (WHERE paper_bot_trade_metrics.status = 'closed'::text AND paper_bot_trade_metrics.realized_pl < 0::numeric) AS losing_trades,
            count(*) FILTER (WHERE paper_bot_trade_metrics.status = ANY (ARRAY['open'::text, 'closing'::text])) AS open_trade_metrics,
            COALESCE(sum(paper_bot_trade_metrics.realized_pl) FILTER (WHERE paper_bot_trade_metrics.status = 'closed'::text), 0::numeric) AS measured_realized_pl,
            max(paper_bot_trade_metrics.closed_at) AS latest_closed_at
           FROM paper_bot_trade_metrics
          GROUP BY paper_bot_trade_metrics.bot_id
        ), broker AS (
         SELECT paper_bot_broker_orders.bot_id,
            count(*) FILTER (WHERE paper_bot_broker_orders.side = 'buy'::text) AS broker_buy_orders,
            count(*) FILTER (WHERE paper_bot_broker_orders.side = 'buy'::text AND COALESCE(paper_bot_broker_orders.filled_quantity, 0::numeric) > 0::numeric) AS filled_buy_orders,
            count(*) FILTER (WHERE paper_bot_broker_orders.side = 'buy'::text AND (paper_bot_broker_orders.status = ANY (ARRAY['rejected'::text, 'canceled'::text, 'cancelled'::text, 'expired'::text]))) AS unfilled_buy_orders,
            max(paper_bot_broker_orders.submitted_at) AS latest_broker_order_at
           FROM paper_bot_broker_orders
          GROUP BY paper_bot_broker_orders.bot_id
        ), staged AS (
         SELECT paper_bot_orders.bot_id,
            count(*) FILTER (WHERE paper_bot_orders.side = 'buy'::text) AS staged_buy_orders,
            count(*) FILTER (WHERE paper_bot_orders.side = 'buy'::text AND paper_bot_orders.status = 'expired'::text) AS expired_buy_orders,
            count(*) FILTER (WHERE paper_bot_orders.side = 'buy'::text AND paper_bot_orders.status = 'prepared'::text) AS prepared_buy_orders
           FROM paper_bot_orders
          GROUP BY paper_bot_orders.bot_id
        ), shadow AS (
         SELECT paper_bot_counterfactuals.bot_id,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = 'completed'::text) AS completed_shadow_scenarios,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = 'completed'::text AND paper_bot_counterfactuals.first_outcome = 'two-r-before-stop'::text) AS shadow_2r_before_stop,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = 'completed'::text AND paper_bot_counterfactuals.first_outcome = 'stop-before-one-r'::text) AS shadow_stop_before_1r,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = 'completed'::text AND paper_bot_counterfactuals.first_outcome = 'stop-after-one-r'::text) AS shadow_stop_after_1r,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = ANY (ARRAY['watching'::text, 'triggered'::text])) AS unsettled_shadow_scenarios,
            count(*) FILTER (WHERE paper_bot_counterfactuals.status = 'superseded'::text) AS superseded_shadow_scenarios
           FROM paper_bot_counterfactuals
          GROUP BY paper_bot_counterfactuals.bot_id
        ), assignments AS (
         SELECT l_1.bot_id,
            count(*) FILTER (WHERE l_1.bot_id = ANY (p.assigned_bot_ids)) AS current_assigned,
            count(*) FILTER (WHERE l_1.bot_id = ANY (p.suggested_bot_ids)) AS current_suggested,
            count(*) FILTER (WHERE (l_1.bot_id = ANY (p.assigned_bot_ids)) AND p.status = 'review-ready'::text) AS current_review_ready
           FROM paper_bot_ledgers l_1
             LEFT JOIN paper_prospects p ON (l_1.bot_id = ANY (p.assigned_bot_ids)) OR (l_1.bot_id = ANY (p.suggested_bot_ids))
          GROUP BY l_1.bot_id
        )
 SELECT l.bot_id,
    l.display_name,
    l.status,
    l.strategy_id,
    l.strategy_version,
    l.starting_cash,
    l.equity,
    l.cash,
    l.realized_pl,
    l.unrealized_pl,
    l.last_synced_at,
        CASE
            WHEN l.metadata ? 'executionEnabled'::text THEN (l.metadata ->> 'executionEnabled'::text)::boolean
            ELSE NULL::boolean
        END AS execution_enabled,
    COALESCE(j.events_24h, 0::bigint) AS events_24h,
    COALESCE(j.events_7d, 0::bigint) AS events_7d,
    COALESCE(j.candidate_checks_24h, 0::bigint) AS candidate_checks_24h,
    COALESCE(j.candidate_checks_7d, 0::bigint) AS candidate_checks_7d,
    COALESCE(j.rejections_7d, 0::bigint) AS rejections_7d,
    COALESCE(j.authorizations_7d, 0::bigint) AS authorizations_7d,
    COALESCE(j.system_checks_7d, 0::bigint) AS system_checks_7d,
    COALESCE(j.distinct_symbols_24h, 0::bigint) AS distinct_symbols_24h,
    COALESCE(j.distinct_symbols_7d, 0::bigint) AS distinct_symbols_7d,
    j.latest_journal_at,
    j.latest_candidate_at,
    COALESCE(t.closed_trades, 0::bigint) AS closed_trades,
    COALESCE(t.winning_trades, 0::bigint) AS winning_trades,
    COALESCE(t.losing_trades, 0::bigint) AS losing_trades,
    COALESCE(t.open_trade_metrics, 0::bigint) AS open_trade_metrics,
    t.latest_closed_at,
    COALESCE(b.broker_buy_orders, 0::bigint) AS broker_buy_orders,
    COALESCE(b.filled_buy_orders, 0::bigint) AS filled_buy_orders,
    COALESCE(b.unfilled_buy_orders, 0::bigint) AS unfilled_buy_orders,
    COALESCE(s.staged_buy_orders, 0::bigint) AS staged_buy_orders,
    COALESCE(s.expired_buy_orders, 0::bigint) AS expired_buy_orders,
    COALESCE(s.prepared_buy_orders, 0::bigint) AS prepared_buy_orders,
    COALESCE(sh.completed_shadow_scenarios, 0::bigint) AS completed_shadow_scenarios,
    COALESCE(sh.shadow_2r_before_stop, 0::bigint) AS shadow_2r_before_stop,
    COALESCE(sh.shadow_stop_before_1r, 0::bigint) AS shadow_stop_before_1r,
    COALESCE(sh.shadow_stop_after_1r, 0::bigint) AS shadow_stop_after_1r,
    COALESCE(sh.unsettled_shadow_scenarios, 0::bigint) AS unsettled_shadow_scenarios,
    COALESCE(sh.superseded_shadow_scenarios, 0::bigint) AS superseded_shadow_scenarios,
    COALESCE(a.current_assigned, 0::bigint) AS current_assigned,
    COALESCE(a.current_suggested, 0::bigint) AS current_suggested,
    COALESCE(a.current_review_ready, 0::bigint) AS current_review_ready
   FROM paper_bot_ledgers l
     LEFT JOIN journal j USING (bot_id)
     LEFT JOIN trades t USING (bot_id)
     LEFT JOIN broker b USING (bot_id)
     LEFT JOIN staged s USING (bot_id)
     LEFT JOIN shadow sh USING (bot_id)
     LEFT JOIN assignments a USING (bot_id);

COMMENT ON VIEW public.paper_bot_performance_audit_v1 IS
'Read-only paper-trading audit; candidate checks are repeated evaluations, not independent opportunities; shadow +2R outcomes are hypothetical, not verified missed profits.';
