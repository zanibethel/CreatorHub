create or replace function public.paper_bot_sync_default_ledger(p_payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Direct broker-account mirroring is disabled for virtual bot ledgers';
end $$;
revoke all on function public.paper_bot_sync_default_ledger(jsonb) from public, anon, authenticated, service_role;

create or replace function public.paper_report_save_snapshot(p_source_key text,p_payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_collected_at timestamptz;
begin
  if p_source_key !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid report payload'; end if;
  v_collected_at := (p_payload->>'collectedAt')::timestamptz;
  update public.paper_report_state set source_key=p_source_key,payload=p_payload,status='ready',last_attempt_at=now(),next_sync_at=now()+interval '20 seconds',lease_until=now(),message=null where report_key='main';
  insert into public.paper_report_history(source_key,bucket_minute,collected_at,equity)
  values (p_source_key,date_trunc('minute',v_collected_at),v_collected_at,(p_payload->'account'->>'equity')::numeric)
  on conflict (source_key,bucket_minute) do update set collected_at=excluded.collected_at,equity=excluded.equity;
end $$;
revoke all on function public.paper_report_save_snapshot(text,jsonb) from public, anon, authenticated;
grant execute on function public.paper_report_save_snapshot(text,jsonb) to service_role;

delete from public.paper_bot_positions where bot_id='default-diverse';
delete from public.paper_bot_equity_history where bot_id='default-diverse';

update public.paper_bot_ledgers set cash=starting_cash,equity=starting_cash,realized_pl=0,unrealized_pl=0,buying_power=starting_cash,
  peak_equity=starting_cash,current_drawdown_pct=0,open_planned_risk_pct=0,correlated_risk_pct=0,daily_realized_loss_pct=0,
  weekly_drawdown_pct=0,last_synced_at=now(),source='virtual-ledger',
  metadata=metadata||'{"brokerAccountEquityIsNotBotEquity":true,"executionVenue":"alpaca-paper","ledgerAuthority":"bot-tagged fills only"}'::jsonb,
  updated_at=now()
where bot_id='default-diverse' and not exists (select 1 from public.paper_bot_journal where bot_id='default-diverse');

update public.paper_bot_ledgers set buying_power=starting_cash,open_planned_risk_pct=0,correlated_risk_pct=0,daily_realized_loss_pct=0,
  weekly_drawdown_pct=0,source='virtual-ledger',updated_at=now() where status='planned';

insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
select bot_id,date_trunc('minute',now()),now(),equity,cash,realized_pl,unrealized_pl from public.paper_bot_ledgers
on conflict (bot_id,bucket_minute) do update set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;
