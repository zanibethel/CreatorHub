-- Broker credentials live in Edge Function secrets. Only the scheduler token is in Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.paper_report_state (
  report_key text primary key check (report_key = 'main'),
  cron_token_hash text not null,
  source_key text,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending','ready','setup_required','error')),
  last_attempt_at timestamptz,
  next_sync_at timestamptz not null default '1970-01-01T00:00:00Z',
  lease_until timestamptz not null default '1970-01-01T00:00:00Z',
  message text
);
create table public.paper_report_history (
  source_key text not null,
  bucket_hour timestamptz not null,
  collected_at timestamptz not null,
  equity numeric not null,
  primary key (source_key, bucket_hour)
);
create index paper_report_history_collected on public.paper_report_history (source_key, collected_at desc);
alter table public.paper_report_state enable row level security;
alter table public.paper_report_history enable row level security;
revoke all on public.paper_report_state, public.paper_report_history from public, anon, authenticated;
grant select, insert, update on public.paper_report_state, public.paper_report_history to service_role;

-- Generate the scheduler credential within the database without returning its value.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'creatorhub-paper-report-cron') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'creatorhub-paper-report-cron', 'Private paper report collector scheduler token');
  end if;
  insert into public.paper_report_state (report_key, cron_token_hash)
  select 'main', encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex')
  from vault.decrypted_secrets where name = 'creatorhub-paper-report-cron';
end $$;

create function public.paper_report_claim_refresh() returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.paper_report_state set lease_until = now() + interval '90 seconds'
  where report_key = 'main' and next_sync_at <= now() and lease_until <= now();
  return found;
end $$;

create function public.paper_report_save_snapshot(p_source_key text, p_payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_collected_at timestamptz;
begin
  if p_source_key !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid report payload';
  end if;
  v_collected_at := (p_payload->>'collectedAt')::timestamptz;
  update public.paper_report_state set source_key = p_source_key, payload = p_payload, status = 'ready',
    last_attempt_at = now(), next_sync_at = now() + interval '1 hour', lease_until = now(), message = null
  where report_key = 'main';
  insert into public.paper_report_history(source_key, bucket_hour, collected_at, equity)
  values (p_source_key, date_trunc('hour', v_collected_at), v_collected_at, (p_payload->'account'->>'equity')::numeric)
  on conflict (source_key, bucket_hour) do update set collected_at = excluded.collected_at, equity = excluded.equity;
end $$;

create function public.paper_report_record_failure(p_message text, p_status text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('setup_required','error') then raise exception 'Invalid report status'; end if;
  update public.paper_report_state set status = p_status, message = left(p_message, 200),
    last_attempt_at = now(), next_sync_at = now() + interval '5 minutes', lease_until = now()
  where report_key = 'main';
end $$;

revoke all on function public.paper_report_claim_refresh(), public.paper_report_save_snapshot(text,jsonb), public.paper_report_record_failure(text,text) from public, anon, authenticated;
grant execute on function public.paper_report_claim_refresh(), public.paper_report_save_snapshot(text,jsonb), public.paper_report_record_failure(text,text) to service_role;

-- Fixed destination; caller input cannot change the host, source account or request body.
create function public.paper_report_dispatch() returns bigint
language sql security invoker set search_path = '' as $$
  select net.http_post(
    url := 'https://yufptpfiwdbzzrvhkvux.supabase.co/functions/v1/paper-report-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'apikey','sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh',
      'x-paper-report-token',(select decrypted_secret from vault.decrypted_secrets where name = 'creatorhub-paper-report-cron')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$;
revoke all on function public.paper_report_dispatch() from public, anon, authenticated, service_role;
-- Heartbeat detects newly configured credentials/retries errors within five minutes.
-- The atomic lease and next_sync_at allow successful account pulls only once per hour.
select cron.schedule('creatorhub-paper-report', '*/5 * * * *', 'select public.paper_report_dispatch();');
