-- CreatorHub social publishing v1
-- Public-read bucket so Instagram can fetch media during publishing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creatorhub-social',
  'creatorhub-social',
  true,
  10485760,
  array['image/jpeg']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Creators can upload social assets" on storage.objects;
create policy "Creators can upload social assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'creatorhub-social'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can read own social assets" on storage.objects;
create policy "Creators can read own social assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'creatorhub-social'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can update social assets" on storage.objects;
create policy "Creators can update social assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'creatorhub-social'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'creatorhub-social'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can delete social assets" on storage.objects;
create policy "Creators can delete social assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'creatorhub-social'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  provider text not null default 'instagram' check (provider in ('instagram')),
  status text not null default 'publishing' check (status in ('draft','publishing','published','error')),
  asset_path text,
  asset_url text,
  caption text not null default '',
  external_media_id text,
  permalink text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.social_posts enable row level security;

drop policy if exists social_posts_owner_all on public.social_posts;
create policy social_posts_owner_all
on public.social_posts
for all
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.creators c
    where c.id = social_posts.creator_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.creators c
    where c.id = social_posts.creator_id
      and c.user_id = (select auth.uid())
  )
);

create index if not exists social_posts_creator_created_idx
  on public.social_posts (creator_id, created_at desc);
