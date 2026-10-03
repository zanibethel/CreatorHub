alter table public.paper_bot_positions
  add column if not exists initial_protective_stop numeric(28,10),
  add column if not exists exit_manager_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(exit_manager_state)='object'),
  add column if not exists last_exit_manager_at timestamptz;

update public.paper_bot_positions
set initial_protective_stop=protective_stop,
    exit_manager_state=exit_manager_state || jsonb_build_object(
      'version','paper-exit-v1',
      'partialProfitState',coalesce(exit_manager_state->>'partialProfitState','armed')
    )
where protective_stop is not null
  and initial_protective_stop is null;

revoke all on function public.paper_bot_position_profit_plan_defaults() from public,anon,authenticated;
grant execute on function public.paper_bot_position_profit_plan_defaults() to service_role;
