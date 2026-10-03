-- Preserve existing history while collecting every 30 seconds and recording minute points.
alter table public.paper_report_history rename column bucket_hour to bucket_minute;

create or replace function public.paper_report_save_snapshot(p_source_key text, p_payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_collected_at timestamptz;
begin
  if p_source_key !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid report payload';
  end if;
  v_collected_at := (p_payload->>'collectedAt')::timestamptz;
  update public.paper_report_state set source_key = p_source_key, payload = p_payload, status = 'ready',
    last_attempt_at = now(), next_sync_at = now() + interval '20 seconds', lease_until = now(), message = null
  where report_key = 'main';
  insert into public.paper_report_history(source_key, bucket_minute, collected_at, equity)
  values (p_source_key, date_trunc('minute', v_collected_at), v_collected_at, (p_payload->'account'->>'equity')::numeric)
  on conflict (source_key, bucket_minute) do update set collected_at = excluded.collected_at, equity = excluded.equity;
end $$;

create or replace function public.paper_report_record_failure(p_message text, p_status text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('setup_required','error') then raise exception 'Invalid report status'; end if;
  update public.paper_report_state set status = p_status, message = left(p_message, 200),
    last_attempt_at = now(), next_sync_at = now() + interval '1 minute', lease_until = now()
  where report_key = 'main';
end $$;

-- Twenty-second cooldown leaves time for each 30-second heartbeat after request latency.
select cron.schedule('creatorhub-paper-report', '30 seconds', 'select public.paper_report_dispatch();');
update public.paper_report_state set next_sync_at = now() where report_key = 'main' and lease_until <= now();
