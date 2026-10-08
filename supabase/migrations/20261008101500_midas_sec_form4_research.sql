-- Midas research: public Form 4 non-derivative Table I data, never order authority.
create table if not exists public.paper_midas_sec_insider_transactions (
  id bigint generated always as identity primary key,
  issuer_cik text not null check (issuer_cik ~ '^[0-9]{1,10}$'),
  issuer_ticker text not null check (issuer_ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  issuer_name text not null,
  owner_cik text not null check (owner_cik ~ '^[0-9]{1,10}$'),
  owner_name text not null,
  owner_role text not null default '',
  accession text not null check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  filing_accepted_at_raw text,
  filing_date date not null,
  observed_at timestamptz not null,
  transaction_date date not null,
  transaction_index integer not null check (transaction_index between 0 and 99),
  security_title text not null,
  transaction_code text not null check (transaction_code ~ '^[A-Z]$'),
  acquire_dispose text not null check (acquire_dispose in ('A','D')),
  shares numeric not null check (shares > 0),
  price_per_share numeric check (price_per_share >= 0),
  reported_notional_usd numeric check (reported_notional_usd >= 0),
  ownership_form text check (ownership_form in ('D','I')),
  plan_10b5_1 boolean,
  classification text not null check (classification in ('reported_purchase','reported_sale','other_reported_transaction')),
  source_url text not null check (source_url like 'https://www.sec.gov/Archives/edgar/data/%'),
  source_name text not null default 'sec-edgar-form4',
  execution_enabled boolean not null default false check (execution_enabled = false),
  created_at timestamptz not null default now(),
  constraint paper_midas_sec_insider_unique_line unique (issuer_cik, accession, transaction_index),
  constraint paper_midas_sec_insider_knowledge_fence check (observed_at >= transaction_date::timestamptz)
);
create index if not exists paper_midas_sec_insider_recent on public.paper_midas_sec_insider_transactions (observed_at desc);
create index if not exists paper_midas_sec_insider_ticker on public.paper_midas_sec_insider_transactions (issuer_ticker, observed_at desc);
create table if not exists public.paper_midas_sec_scan_runs (
 id bigint generated always as identity primary key,
 collected_at timestamptz not null default now(),
 status text not null check (status in ('ok','partial','source-unavailable','not-configured')),
 symbols_checked integer not null default 0,
 filings_checked integer not null default 0,
 rows_saved_or_deduplicated integer not null default 0,
 source_failures jsonb not null default '[]'::jsonb,
 research_only boolean not null default true check (research_only = true)
);
create index if not exists paper_midas_sec_runs_recent on public.paper_midas_sec_scan_runs (collected_at desc);
alter table public.paper_midas_sec_insider_transactions enable row level security;
alter table public.paper_midas_sec_scan_runs enable row level security;
revoke all on public.paper_midas_sec_insider_transactions from anon, authenticated;
revoke all on public.paper_midas_sec_scan_runs from anon, authenticated;
grant all on public.paper_midas_sec_insider_transactions to service_role;
grant all on public.paper_midas_sec_scan_runs to service_role;
comment on table public.paper_midas_sec_insider_transactions is 'Named SEC Form 4 non-derivative reported changes; earliest safe feature time is observed_at, not dated transaction or filing period. Research only.';
