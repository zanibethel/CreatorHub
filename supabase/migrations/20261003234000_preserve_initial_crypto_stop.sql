create or replace function public.paper_bot_position_profit_plan_defaults()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_plan record;
begin
  if new.initial_protective_stop is null and new.protective_stop is not null then
    new.initial_protective_stop := new.protective_stop;
  end if;

  if new.take_profit_price is null
     or new.take_profit_fraction is null
     or new.take_profit_r is null
     or new.protect_winner_at_r is null then
    select take_profit_price,take_profit_fraction,take_profit_r,protect_winner_at_r,trail_remainder
      into v_plan
    from public.paper_bot_orders
    where bot_id=new.bot_id
      and symbol=new.symbol
      and side='buy'
      and strategy_id is not distinct from new.strategy_id
      and strategy_version is not distinct from new.strategy_version
    order by created_at desc
    limit 1;

    if found then
      new.take_profit_price := coalesce(new.take_profit_price,v_plan.take_profit_price);
      new.take_profit_fraction := coalesce(new.take_profit_fraction,v_plan.take_profit_fraction);
      new.take_profit_r := coalesce(new.take_profit_r,v_plan.take_profit_r);
      new.protect_winner_at_r := coalesce(new.protect_winner_at_r,v_plan.protect_winner_at_r);
      new.trail_remainder := coalesce(new.trail_remainder,v_plan.trail_remainder,false);
    end if;
  end if;
  return new;
end $$;

revoke all on function public.paper_bot_position_profit_plan_defaults() from public,anon,authenticated;
grant execute on function public.paper_bot_position_profit_plan_defaults() to service_role;
