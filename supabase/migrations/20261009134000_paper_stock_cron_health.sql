-- Durable operational evidence for the six existing PAPER stock bot cron routes.
-- The functions do not trade, move money, change order state, or create alerts.
create table if not exists public.paper_bot_cron_health (
  job_key text primary key check (job_key in (
    'pulse-run','pulse-manage','fuse-run','fuse-manage','atlas-run','harbor-run'
  )),
  bot_id text not null references public.paper_bot_ledgers(bot_id),
  expected_minutes integer not null check (expected_minutes in (1,5)),
  last_observed_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_source text not null check (last_source in ('vercel-cron-agent','authenticated-other')),
  last_http_status integer not null check (last_http_status between 100 and 599),
  last_action text not null,
  last_duration_ms integer not null check (last_duration_ms>=0 and last_duration_ms<=300000),
  consecutive_failures integer not null default 0,
  total_runs bigint not null default 0,
  total_failures bigint not null default 0,
  last_error text
);
alter table public.paper_bot_cron_health enable row level security;
revoke all on public.paper_bot_cron_health from public,anon,authenticated;
grant select on public.paper_bot_cron_health to service_role;

create or replace function public.paper_bot_record_cron_health(
 p_job_key text,p_bot_id text,p_expected_minutes integer,
 p_source text,p_http_status integer,p_action text,p_duration_ms integer,
 p_error text default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_now timestamptz:=pg_catalog.now();
declare v_failure boolean;
begin
 if auth.role() is distinct from 'service_role'
    or p_job_key not in ('pulse-run','pulse-manage','fuse-run','fuse-manage','atlas-run','harbor-run')
    or (p_job_key,p_bot_id,p_expected_minutes) not in (
      ('pulse-run','momentum-breakout-100',5),
      ('pulse-manage','momentum-breakout-100',1),
      ('fuse-run','penny-volatility-day-100',5),
      ('fuse-manage','penny-volatility-day-100',1),
      ('atlas-run','default-diverse',1),
      ('harbor-run','three-trade-weekly-swing-100',5)
    )
    or p_source not in ('vercel-cron-agent','authenticated-other')
    or p_http_status not between 100 and 599
    or p_action is null or length(p_action)>120
    or p_duration_ms is null or p_duration_ms<0 or p_duration_ms>300000
    or p_error is not null and length(p_error)>200
 then return false; end if;
 v_failure:=p_http_status>=400;
 insert into public.paper_bot_cron_health (
   job_key,bot_id,expected_minutes,last_observed_at,last_success_at,
   last_failure_at,last_source,last_http_status,last_action,last_duration_ms,
   consecutive_failures,total_runs,total_failures,last_error
 ) values (
   p_job_key,p_bot_id,p_expected_minutes,v_now,
   case when not v_failure then v_now else null end,
   case when v_failure then v_now else null end,
   p_source,p_http_status,p_action,p_duration_ms,
   case when v_failure then 1 else 0 end,1,
   case when v_failure then 1 else 0 end,
   case when v_failure then p_error else null end
 )
 on conflict(job_key) do update set
   last_observed_at=v_now,
   last_success_at=case when not v_failure then v_now
     else paper_bot_cron_health.last_success_at end,
   last_failure_at=case when v_failure then v_now
     else paper_bot_cron_health.last_failure_at end,
   last_source=excluded.last_source,
   last_http_status=p_http_status,
   last_action=p_action,
   last_duration_ms=p_duration_ms,
   consecutive_failures=case when v_failure then
       paper_bot_cron_health.consecutive_failures+1 else 0 end,
   total_runs=paper_bot_cron_health.total_runs+1,
   total_failures=paper_bot_cron_health.total_failures+
      case when v_failure then 1 else 0 end,
   last_error=case when v_failure then p_error else null end;
 return true;
end $$;

revoke all on function public.paper_bot_record_cron_health(text,text,integer,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.paper_bot_record_cron_health(text,text,integer,text,integer,text,integer,text) to service_role;
