-- CreatorHub creator reference library v1

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-reference-assets',
  'creator-reference-assets',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.creator_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  asset_type text not null default 'character_reference'
    check (asset_type in ('profile_photo','character_reference','style_reference','brand_asset')),
  title text not null default 'Reference image',
  storage_path text not null unique,
  mime_type text,
  prompt_notes text,
  tags jsonb not null default '[]'::jsonb,
  approved boolean not null default true,
  is_primary boolean not null default false,
  source text not null default 'upload'
    check (source in ('upload','generated','imported')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.creator_assets enable row level security;

drop policy if exists creator_assets_owner_all on public.creator_assets;
create policy creator_assets_owner_all
on public.creator_assets
for all
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.creators c
    where c.id = creator_assets.creator_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.creators c
    where c.id = creator_assets.creator_id
      and c.user_id = (select auth.uid())
  )
);

create index if not exists creator_assets_creator_created_idx
  on public.creator_assets (creator_id, created_at desc);

create unique index if not exists creator_assets_one_primary_per_creator_idx
  on public.creator_assets (creator_id)
  where is_primary = true;

drop policy if exists "Creators can upload reference assets" on storage.objects;
create policy "Creators can upload reference assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'creator-reference-assets'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can read reference assets" on storage.objects;
create policy "Creators can read reference assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'creator-reference-assets'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can update reference assets" on storage.objects;
create policy "Creators can update reference assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'creator-reference-assets'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'creator-reference-assets'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Creators can delete reference assets" on storage.objects;
create policy "Creators can delete reference assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'creator-reference-assets'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
