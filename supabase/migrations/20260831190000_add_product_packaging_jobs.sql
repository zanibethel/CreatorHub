create table if not exists public.product_packaging_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  completed_at timestamptz,
  file_path text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.product_packaging_jobs enable row level security;

revoke all on public.product_packaging_jobs from anon, authenticated;
grant all on public.product_packaging_jobs to service_role;

create index if not exists product_packaging_jobs_product_id_idx on public.product_packaging_jobs(product_id);
create index if not exists product_packaging_jobs_status_idx on public.product_packaging_jobs(status);

comment on table public.product_packaging_jobs is 'Server-side one-time jobs used to package CreatorHub product assets securely.';
