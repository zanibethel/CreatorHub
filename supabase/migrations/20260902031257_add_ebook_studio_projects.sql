create table if not exists public.ebook_projects (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  title text not null default 'Untitled ebook',
  topic text not null,
  target_audience text not null,
  core_promise text not null,
  tone text not null default 'clear and practical',
  target_word_count integer not null default 12000 check (target_word_count between 1000 and 100000),
  price_cents integer not null default 900 check (price_cents >= 0),
  currency text not null default 'usd',
  distribution_mode text not null default 'private' check (distribution_mode in ('private','affiliate','marketplace')),
  promoter_commission_bps integer check (promoter_commission_bps is null or promoter_commission_bps between 0 and 10000),
  status text not null default 'planning' check (status in ('planning','outlining','drafting','review','ready','converted','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ebook_chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ebook_projects(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  summary text not null default '',
  content text not null default '',
  status text not null default 'planned' check (status in ('planned','drafting','review','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position)
);

create index if not exists ebook_projects_owner_user_id_idx on public.ebook_projects(owner_user_id);
create index if not exists ebook_projects_creator_id_idx on public.ebook_projects(creator_id);
create index if not exists ebook_projects_product_id_idx on public.ebook_projects(product_id);
create index if not exists ebook_chapters_project_id_position_idx on public.ebook_chapters(project_id, position);

alter table public.ebook_projects enable row level security;
alter table public.ebook_chapters enable row level security;

grant select, insert, update, delete on public.ebook_projects to authenticated;
grant select, insert, update, delete on public.ebook_chapters to authenticated;
grant all on public.ebook_projects to service_role;
grant all on public.ebook_chapters to service_role;

create policy "Owners can view ebook projects"
on public.ebook_projects for select
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "Owners can create ebook projects"
on public.ebook_projects for insert
to authenticated
with check (
  (select auth.uid()) = owner_user_id
  and exists (
    select 1 from public.creators c
    where c.id = ebook_projects.creator_id
      and c.user_id = (select auth.uid())
  )
);

create policy "Owners can update ebook projects"
on public.ebook_projects for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check (
  (select auth.uid()) = owner_user_id
  and exists (
    select 1 from public.creators c
    where c.id = ebook_projects.creator_id
      and c.user_id = (select auth.uid())
  )
);

create policy "Owners can delete ebook projects"
on public.ebook_projects for delete
to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "Owners can view ebook chapters"
on public.ebook_chapters for select
to authenticated
using (
  exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can create ebook chapters"
on public.ebook_chapters for insert
to authenticated
with check (
  exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can update ebook chapters"
on public.ebook_chapters for update
to authenticated
using (
  exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can delete ebook chapters"
on public.ebook_chapters for delete
to authenticated
using (
  exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);
