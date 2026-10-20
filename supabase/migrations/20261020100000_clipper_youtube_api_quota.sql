-- Pass 1: atomic server-only YouTube Data API reservations.
-- Public/anonymous/authenticated roles receive NO access to these ledgers/RPC.
-- Accounts share the same project daily bucket; separate creator workspaces
-- under one auth user do NOT create extra entitlement.
create table if not exists public.clipper_youtube_project_quota (
  period_day date not null,
  bucket text not null check (bucket in ('search.list', 'channels.list')),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (period_day, bucket)
);

create table if not exists public.clipper_youtube_account_quota (
  period_day date not null,
  bucket text not null check (bucket in ('search.list', 'channels.list')),
  user_id uuid not null references auth.users(id) on delete cascade,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (period_day, bucket, user_id)
);

create table if not exists public.clipper_youtube_burst_quota (
  minute_start timestamptz not null,
  bucket text not null check (bucket in ('search.list', 'channels.list')),
  user_id uuid not null references auth.users(id) on delete cascade,
  used integer not null default 0 check (used >= 0),
  primary key (minute_start, bucket, user_id)
);

alter table public.clipper_youtube_project_quota enable row level security;
alter table public.clipper_youtube_account_quota enable row level security;
alter table public.clipper_youtube_burst_quota enable row level security;

revoke all on table public.clipper_youtube_project_quota from public, anon, authenticated;
revoke all on table public.clipper_youtube_account_quota from public, anon, authenticated;
revoke all on table public.clipper_youtube_burst_quota from public, anon, authenticated;
grant select, insert, update, delete on public.clipper_youtube_project_quota to service_role;
grant select, insert, update, delete on public.clipper_youtube_account_quota to service_role;
grant select, insert, update, delete on public.clipper_youtube_burst_quota to service_role;

-- A single Postgres transaction serializes reservations by locking the
-- shared project row first, then the user row and the minute window.
-- A rejected attempt performs no counter increments. Once accepted, a request
-- is counted even if Google's API later fails (failures can consume quota).
create or replace function public.clipper_youtube_reserve_quota(
  p_user_id uuid,
  p_bucket text,
  p_account_limit integer,
  p_project_limit integer,
  p_burst_limit integer,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_minute timestamptz;
  v_account_used integer;
  v_project_used integer;
  v_burst_used integer;
  v_reset_at timestamptz;
  v_burst_reset timestamptz;
  v_reason text;
begin
  if p_user_id is null or p_at is null or
     p_bucket not in ('search.list', 'channels.list') or
     p_account_limit not between 1 and 10000 or
     p_project_limit not between 1 and 10000 or
     p_burst_limit not between 1 and 100 then
    raise exception 'Invalid YouTube quota reservation arguments' using errcode = '22023';
  end if;

  v_day := (p_at at time zone 'America/Los_Angeles')::date;
  v_reset_at := ((v_day + 1)::timestamp at time zone 'America/Los_Angeles');
  v_minute := date_trunc('minute', p_at);
  v_burst_reset := v_minute + interval '1 minute';

  insert into public.clipper_youtube_project_quota (period_day, bucket)
  values (v_day, p_bucket) on conflict do nothing;
  select used into strict v_project_used from public.clipper_youtube_project_quota
    where period_day = v_day and bucket = p_bucket for update;

  insert into public.clipper_youtube_account_quota (period_day, bucket, user_id)
  values (v_day, p_bucket, p_user_id) on conflict do nothing;
  select used into strict v_account_used from public.clipper_youtube_account_quota
    where period_day = v_day and bucket = p_bucket and user_id = p_user_id for update;

  insert into public.clipper_youtube_burst_quota (minute_start, bucket, user_id)
  values (v_minute, p_bucket, p_user_id) on conflict do nothing;
  select used into strict v_burst_used from public.clipper_youtube_burst_quota
    where minute_start = v_minute and bucket = p_bucket and user_id = p_user_id for update;

  v_reason := case
    when v_project_used >= p_project_limit then 'project_limit'
    when v_account_used >= p_account_limit then 'account_limit'
    when v_burst_used >= p_burst_limit then 'burst_limit'
    else null
  end;

  if v_reason is null then
    update public.clipper_youtube_project_quota
      set used = used + 1, updated_at = now()
      where period_day = v_day and bucket = p_bucket;
    update public.clipper_youtube_account_quota
      set used = used + 1, updated_at = now()
      where period_day = v_day and bucket = p_bucket and user_id = p_user_id;
    update public.clipper_youtube_burst_quota
      set used = used + 1
      where minute_start = v_minute and bucket = p_bucket and user_id = p_user_id;
    v_project_used := v_project_used + 1;
    v_account_used := v_account_used + 1;
    v_burst_used := v_burst_used + 1;
  end if;

  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'bucket', p_bucket,
    'accountUsed', v_account_used,
    'accountLimit', p_account_limit,
    'projectUsed', v_project_used,
    'projectLimit', p_project_limit,
    'burstUsed', v_burst_used,
    'burstLimit', p_burst_limit,
    'resetsAt', v_reset_at,
    'retryAt', case when v_reason = 'burst_limit' then v_burst_reset else v_reset_at end
  );
end;
$$;

revoke all on function public.clipper_youtube_reserve_quota(
  uuid, text, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.clipper_youtube_reserve_quota(
  uuid, text, integer, integer, integer, timestamptz
) to service_role;

-- Operations must not be exposed to client credentials even though the
-- front-end can read its own usage through a dedicated authenticated API.
