drop policy if exists "Owners can view ebook projects" on public.ebook_projects;
drop policy if exists "Owners can create ebook projects" on public.ebook_projects;
drop policy if exists "Owners can update ebook projects" on public.ebook_projects;
drop policy if exists "Owners can delete ebook projects" on public.ebook_projects;
drop policy if exists "Owners can view ebook chapters" on public.ebook_chapters;
drop policy if exists "Owners can create ebook chapters" on public.ebook_chapters;
drop policy if exists "Owners can update ebook chapters" on public.ebook_chapters;
drop policy if exists "Owners can delete ebook chapters" on public.ebook_chapters;

create policy "Owners can view ebook projects"
on public.ebook_projects for select
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = owner_user_id
);

create policy "Owners can create ebook projects"
on public.ebook_projects for insert
to authenticated
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = owner_user_id
  and exists (
    select 1 from public.creators c
    where c.id = ebook_projects.creator_id
      and c.user_id = (select auth.uid())
  )
);

create policy "Owners can update ebook projects"
on public.ebook_projects for update
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = owner_user_id
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = owner_user_id
  and exists (
    select 1 from public.creators c
    where c.id = ebook_projects.creator_id
      and c.user_id = (select auth.uid())
  )
);

create policy "Owners can delete ebook projects"
on public.ebook_projects for delete
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and (select auth.uid()) = owner_user_id
);

create policy "Owners can view ebook chapters"
on public.ebook_chapters for select
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can create ebook chapters"
on public.ebook_chapters for insert
to authenticated
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can update ebook chapters"
on public.ebook_chapters for update
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);

create policy "Owners can delete ebook chapters"
on public.ebook_chapters for delete
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.ebook_projects p
    where p.id = ebook_chapters.project_id
      and p.owner_user_id = (select auth.uid())
  )
);
