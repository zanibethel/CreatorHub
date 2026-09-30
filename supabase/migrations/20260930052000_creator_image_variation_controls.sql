alter table public.creator_image_jobs
  add column if not exists variation_mode text not null default 'balanced',
  add column if not exists seed integer;

alter table public.creator_image_jobs
  drop constraint if exists creator_image_jobs_variation_mode_check,
  add constraint creator_image_jobs_variation_mode_check
    check (variation_mode in ('preserve','balanced','new-scene'));

alter table public.creator_image_jobs
  drop constraint if exists creator_image_jobs_seed_check,
  add constraint creator_image_jobs_seed_check
    check (seed is null or (seed >= 0 and seed <= 2147483647));
