-- CreatorHub AI Clipper: public YouTube channel bookmarks only.
-- Saving a public channel does not establish ownership, OAuth authorization, or media rights.
create table if not exists public.clipper_youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  channel_title text not null,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  unique (creator_id, channel_id)
);

alter table public.clipper_youtube_channels enable row level security;
grant select, insert, update, delete on public.clipper_youtube_channels to authenticated;

drop policy if exists clipper_youtube_channels_owner on public.clipper_youtube_channels;
create policy clipper_youtube_channels_owner
  on public.clipper_youtube_channels for all to authenticated
  using (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.creators c
      where c.id = clipper_youtube_channels.creator_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.creators c
      where c.id = clipper_youtube_channels.creator_id
        and c.user_id = (select auth.uid())
    )
  );

create index if not exists clipper_youtube_channels_user_creator_idx
  on public.clipper_youtube_channels(user_id, creator_id, created_at desc);
