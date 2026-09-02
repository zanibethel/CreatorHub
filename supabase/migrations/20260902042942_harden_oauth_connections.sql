drop policy if exists integration_connections_owner_all on public.integration_connections;

create policy integration_connections_owner_all
on public.integration_connections
for all
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = user_id
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = user_id
  and (
    creator_id is null
    or exists (
      select 1 from public.creators c
      where c.id = integration_connections.creator_id
        and c.user_id = (select auth.uid())
    )
  )
);

create unique index if not exists integration_connections_one_per_workspace_provider_idx
on public.integration_connections (user_id, creator_id, provider) nulls not distinct;
