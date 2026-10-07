-- CreatorHub transfer-only account gate v1
-- Existing accounts retain full test access. New accounts default to transfer-only.

create schema if not exists private;

create table if not exists public.creatorhub_account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_level text not null default 'transfer_only'
    check (access_level in ('full','transfer_only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creatorhub_account_access enable row level security;
grant select on public.creatorhub_account_access to authenticated;

drop policy if exists creatorhub_account_access_read_own on public.creatorhub_account_access;
create policy creatorhub_account_access_read_own
on public.creatorhub_account_access
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.creatorhub_account_access (user_id, access_level)
select id, 'full'
from auth.users
on conflict (user_id) do nothing;

create or replace function private.creatorhub_default_account_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.creatorhub_account_access (user_id, access_level)
  values (new.id, 'transfer_only')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.creatorhub_default_account_access() from public;
revoke all on function private.creatorhub_default_account_access() from anon;
revoke all on function private.creatorhub_default_account_access() from authenticated;

drop trigger if exists creatorhub_default_access_on_signup on auth.users;
create trigger creatorhub_default_access_on_signup
after insert on auth.users
for each row execute function private.creatorhub_default_account_access();
