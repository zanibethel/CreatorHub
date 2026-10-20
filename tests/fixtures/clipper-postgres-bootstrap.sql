-- Isolated CI-only PostgreSQL fixture. NEVER apply to Supabase or production.
-- Fake auth functions emulate JWT-scoped auth.uid() and auth.jwt() solely to
-- validate our RLS policy and quota function against actual PostgreSQL.
create schema if not exists auth;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;
grant usage on schema auth, public to authenticated, service_role, anon;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.test_user', true), '')::uuid;
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('app.test_claims', true), '')::jsonb, '{}'::jsonb);
$$;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;

create table if not exists auth.users (id uuid primary key);
create table if not exists public.creators (
 id uuid primary key,
 user_id uuid not null references auth.users(id)
);
grant select on public.creators to authenticated;
