create or replace function public.paper_prospect_preserve_timestamps()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    new.first_seen_at := old.first_seen_at;
    if old.watchlist_eligible and new.first_watchlist_at is null then
      new.first_watchlist_at := old.first_watchlist_at;
    elsif not old.watchlist_eligible and new.watchlist_eligible and new.first_watchlist_at is null then
      new.first_watchlist_at := now();
    end if;
    if old.bot_review_eligible and new.first_review_ready_at is null then
      new.first_review_ready_at := old.first_review_ready_at;
    elsif not old.bot_review_eligible and new.bot_review_eligible and new.first_review_ready_at is null then
      new.first_review_ready_at := now();
    end if;
    new.assigned_bot_ids := array(
      select distinct bot_id
      from unnest(coalesce(old.assigned_bot_ids,'{}'::text[]) || coalesce(new.assigned_bot_ids,'{}'::text[])) as bot_id
      where bot_id <> ''
    );
  else
    if new.watchlist_eligible and new.first_watchlist_at is null then new.first_watchlist_at := now(); end if;
    if new.bot_review_eligible and new.first_review_ready_at is null then new.first_review_ready_at := now(); end if;
  end if;
  return new;
end $$;
