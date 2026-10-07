-- CreatorHub simple upload/share center v1

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creatorhub-uploads', 'creatorhub-uploads', false, 262144000, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.creator_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  share_token uuid not null default gen_random_uuid() unique,
  share_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.creator_uploads enable row level security;

grant select, insert, update, delete on table public.creator_uploads to authenticated;

drop policy if exists creator_uploads_owner_all on public.creator_uploads;
create policy creator_uploads_owner_all
on public.creator_uploads
for all
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and user_id = (select auth.uid())
);

create index if not exists creator_uploads_user_created_idx
  on public.creator_uploads (user_id, created_at desc);

drop policy if exists "CreatorHub users can upload files" on storage.objects;
create policy "CreatorHub users can upload files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'creatorhub-uploads'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "CreatorHub users can read files" on storage.objects;
create policy "CreatorHub users can read files"
on storage.objects for select to authenticated
using (
  bucket_id = 'creatorhub-uploads'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "CreatorHub users can update files" on storage.objects;
create policy "CreatorHub users can update files"
on storage.objects for update to authenticated
using (
  bucket_id = 'creatorhub-uploads'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'creatorhub-uploads'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "CreatorHub users can delete files" on storage.objects;
create policy "CreatorHub users can delete files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'creatorhub-uploads'
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
