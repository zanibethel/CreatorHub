-- Historical Pattern Intelligence v1. All data is research-only and server-side.
create table if not exists public.paper_historical_research_runs (
  id uuid primary key default gen_random_uuid(),
  asset_class text not null check (asset_class in ('stock','crypto')),
  symbol text not null,
  model_version integer not null check (model_version>0),
  as_of timestamptz not null,
  data_source text not null,
  completed_bar_count integer not null check (completed_bar_count>=0),
  historical_example_count integer not null check (historical_example_count>=0),
  feature_snapshot jsonb not null default '{}'::jsonb,
  evaluation_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(asset_class,symbol,model_version,as_of)
);
create index if not exists paper_history_runs_recent_idx
  on public.paper_historical_research_runs(asset_class,symbol,as_of desc);

create table if not exists public.paper_historical_pattern_scores (
  asset_class text not null check (asset_class in ('stock','crypto')),
  symbol text not null,
  horizon text not null check(horizon in ('same-day','3-day','2-week')),
  target_pct integer not null check(target_pct in (4,6,10,15,20)),
  model_version integer not null check(model_version>0),
  as_of timestamptz not null,
  status text not null check(status in ('research-only','insufficient-evidence')),
  shadow_score integer check(shadow_score between 0 and 100),
  matched_count integer not null check(matched_count>=0),
  baseline_hit_rate numeric(10,6),
  similar_hit_rate numeric(10,6),
  ambiguous_count integer not null check(ambiguous_count>=0),
  backtest_evidence jsonb not null default '{}'::jsonb,
  research_run_id uuid not null references public.paper_historical_research_runs(id),
  updated_at timestamptz not null default now(),
  primary key (asset_class,symbol,horizon,target_pct)
);
create index if not exists paper_history_scores_recent_idx
  on public.paper_historical_pattern_scores(as_of desc,shadow_score desc nulls last);

create table if not exists public.paper_historical_event_samples (
  asset_class text not null check(asset_class in ('stock','crypto')),
  symbol text not null,
  model_version integer not null check(model_version>0),
  horizon text not null check(horizon in ('same-day','3-day','2-week')),
  target_pct integer not null check(target_pct in (4,6,10,15,20)),
  decision_at timestamptz not null,
  entry_at timestamptz not null,
  outcome_end_at timestamptz not null,
  entry_price numeric(28,10) not null check(entry_price>0),
  outcome text not null check(outcome in ('target','stop','timeout','ambiguous')),
  max_gain_pct numeric(18,6) not null,
  max_drawdown_pct numeric(18,6) not null,
  terminal_return_pct numeric(18,6) not null,
  features jsonb not null,
  research_run_id uuid not null references public.paper_historical_research_runs(id),
  recorded_at timestamptz not null default now(),
  primary key(asset_class,symbol,model_version,horizon,target_pct,decision_at),
  constraint history_sample_chronology check(decision_at<entry_at and entry_at<=outcome_end_at)
);
create index if not exists paper_history_events_lookback_idx
  on public.paper_historical_event_samples(asset_class,symbol,horizon,target_pct,decision_at desc);
create index if not exists paper_history_events_outcomes_idx
  on public.paper_historical_event_samples(horizon,target_pct,outcome);

alter table public.paper_historical_research_runs enable row level security;
alter table public.paper_historical_pattern_scores enable row level security;
alter table public.paper_historical_event_samples enable row level security;
revoke all on public.paper_historical_research_runs from public,anon,authenticated;
revoke all on public.paper_historical_pattern_scores from public,anon,authenticated;
revoke all on public.paper_historical_event_samples from public,anon,authenticated;
grant all on public.paper_historical_research_runs to service_role;
grant all on public.paper_historical_pattern_scores to service_role;
grant all on public.paper_historical_event_samples to service_role;
