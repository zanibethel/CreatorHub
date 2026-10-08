-- Historical Pattern Intelligence v2 (hourly events + five-minute microstructure, advisory only).
create table if not exists public.paper_intraday_research_runs (
 id uuid primary key default gen_random_uuid(),
 asset_class text not null check(asset_class in ('stock','crypto')),
 symbol text not null,
 model_version integer not null check(model_version=2),
 as_of timestamptz not null,
 hourly_provider text not null,
 daily_provider text not null,
 micro_provider text not null,
 hourly_bars integer not null check(hourly_bars>=0),
 five_minute_bars integer not null check(five_minute_bars>=0),
 daily_bars integer not null check(daily_bars>=0),
 labeled_examples integer not null check(labeled_examples>=0),
 current_features jsonb not null default '{}'::jsonb,
 current_micro jsonb not null default '{}'::jsonb,
 run_summary jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(asset_class,symbol,model_version,as_of)
);
create index if not exists paper_intraday_runs_recent on public.paper_intraday_research_runs(as_of desc);

create table if not exists public.paper_intraday_pattern_scores (
 asset_class text not null check(asset_class in ('stock','crypto')),
 symbol text not null,
 horizon text not null check(horizon in ('24h','72h','14d')),
 target_pct integer not null check(target_pct in (4,6,10,15,20)),
 model_version integer not null check(model_version=2),
 as_of timestamptz not null,
 status text not null check(status in ('research-only','insufficient-evidence','insufficient-coverage')),
 shadow_score integer check(shadow_score between 0 and 100),
 compared_examples integer not null check(compared_examples>=0),
 baseline_hit_rate numeric(10,6),
 matched_hit_rate numeric(10,6),
 outcome_summary jsonb not null default '{}'::jsonb,
 features jsonb not null default '{}'::jsonb,
 micro jsonb not null default '{}'::jsonb,
 research_run_id uuid not null references public.paper_intraday_research_runs(id),
 updated_at timestamptz not null default now(),
 primary key(asset_class,symbol,horizon,target_pct)
);
create index if not exists paper_intraday_scores_recent on public.paper_intraday_pattern_scores(as_of desc,shadow_score desc nulls last);

create table if not exists public.paper_intraday_event_samples (
 asset_class text not null check(asset_class in ('stock','crypto')),
 symbol text not null,
 model_version integer not null check(model_version=2),
 horizon text not null check(horizon in ('24h','72h','14d')),
 target_pct integer not null check(target_pct in (4,6,10,15,20)),
 decision_at timestamptz not null,
 entry_at timestamptz not null,
 outcome_end_at timestamptz not null,
 status text not null check(status in ('target','stop','timeout','ambiguous')),
 entry_price numeric(28,10) not null check(entry_price>0),
 max_gain_pct numeric(18,6) not null,
 max_drawdown_pct numeric(18,6) not null,
 terminal_return_pct numeric(18,6) not null,
 features jsonb not null,
 research_run_id uuid not null references public.paper_intraday_research_runs(id),
 recorded_at timestamptz not null default now(),
 primary key(asset_class,symbol,model_version,horizon,target_pct,decision_at),
 constraint intraday_evidence_times check(decision_at<=entry_at and entry_at<=outcome_end_at)
);
create index if not exists paper_intraday_event_time on public.paper_intraday_event_samples(asset_class,symbol,decision_at desc);

alter table public.paper_intraday_research_runs enable row level security;
alter table public.paper_intraday_pattern_scores enable row level security;
alter table public.paper_intraday_event_samples enable row level security;
revoke all on public.paper_intraday_research_runs from public,anon,authenticated;
revoke all on public.paper_intraday_pattern_scores from public,anon,authenticated;
revoke all on public.paper_intraday_event_samples from public,anon,authenticated;
grant all on public.paper_intraday_research_runs to service_role;
grant all on public.paper_intraday_pattern_scores to service_role;
grant all on public.paper_intraday_event_samples to service_role;
