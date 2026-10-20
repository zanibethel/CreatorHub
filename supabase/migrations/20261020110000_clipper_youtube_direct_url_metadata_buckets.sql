-- Pass 2: quota buckets for direct URL lookups (videos.list and playlistItems.list).
-- All three metadata methods cost one YouTube API unit per accepted attempt.
-- Their conservative default project caps total 9,000 units/day across
-- channels.list, videos.list, and playlistItems.list, before other API clients.
-- Requires the Pass 1 quota migration. No public role gets ledger access.
alter table public.clipper_youtube_project_quota
  drop constraint if exists clipper_youtube_project_quota_bucket_check;
alter table public.clipper_youtube_project_quota
  add constraint clipper_youtube_project_quota_bucket_check
  check (bucket in ('search.list', 'channels.list', 'videos.list', 'playlistItems.list'));

alter table public.clipper_youtube_account_quota
  drop constraint if exists clipper_youtube_account_quota_bucket_check;
alter table public.clipper_youtube_account_quota
  add constraint clipper_youtube_account_quota_bucket_check
  check (bucket in ('search.list', 'channels.list', 'videos.list', 'playlistItems.list'));

alter table public.clipper_youtube_burst_quota
  drop constraint if exists clipper_youtube_burst_quota_bucket_check;
alter table public.clipper_youtube_burst_quota
  add constraint clipper_youtube_burst_quota_bucket_check
  check (bucket in ('search.list', 'channels.list', 'videos.list', 'playlistItems.list'));

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
     p_bucket not in ('search.list', 'channels.list', 'videos.list', 'playlistItems.list') or
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
    update public.clipper_youtube_project_quota set used = used + 1, updated_at = now()
      where period_day = v_day and bucket = p_bucket;
    update public.clipper_youtube_account_quota set used = used + 1, updated_at = now()
      where period_day = v_day and bucket = p_bucket and user_id = p_user_id;
    update public.clipper_youtube_burst_quota set used = used + 1
      where minute_start = v_minute and bucket = p_bucket and user_id = p_user_id;
    v_project_used := v_project_used + 1;
    v_account_used := v_account_used + 1;
    v_burst_used := v_burst_used + 1;
  end if;
  return jsonb_build_object(
    'allowed', v_reason is null, 'reason', v_reason, 'bucket', p_bucket,
    'accountUsed', v_account_used, 'accountLimit', p_account_limit,
    'projectUsed', v_project_used, 'projectLimit', p_project_limit,
    'burstUsed', v_burst_used, 'burstLimit', p_burst_limit,
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
