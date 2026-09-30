create table if not exists public.creator_image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  cooperative_job_id uuid not null unique,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  prompt text not null,
  model_override text not null,
  local_profile text not null check (local_profile in ('fast','quality')),
  aspect_ratio text not null,
  use_references boolean not null default true,
  result_model text,
  result_reference_count integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.creator_image_jobs enable row level security;

create index if not exists creator_image_jobs_owner_creator_idx
  on public.creator_image_jobs(user_id, creator_id, created_at desc);

drop policy if exists creator_image_jobs_select_own on public.creator_image_jobs;
create policy creator_image_jobs_select_own
on public.creator_image_jobs for select to authenticated
using (auth.uid() = user_id);

drop policy if exists creator_image_jobs_insert_own on public.creator_image_jobs;
create policy creator_image_jobs_insert_own
on public.creator_image_jobs for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists creator_image_jobs_update_own on public.creator_image_jobs;
create policy creator_image_jobs_update_own
on public.creator_image_jobs for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.creator_image_jobs to authenticated;
