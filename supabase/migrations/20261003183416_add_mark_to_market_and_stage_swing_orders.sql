alter table public.paper_bot_ledgers
  add column if not exists pool_usage jsonb not null default '{"day":0,"multi-day":0,"multi-week":0}'::jsonb
    check (jsonb_typeof(pool_usage)='object');

alter table public.paper_bot_orders
  add column if not exists pool_id text check (pool_id is null or pool_id in ('day','multi-day','multi-week')),
  add column if not exists entry_trigger numeric(28,10),
  add column if not exists max_entry_price numeric(28,10),
  add column if not exists protective_stop numeric(28,10),
  add column if not exists planned_risk_dollars numeric(18,6),
  add column if not exists expires_at timestamptz,
  add column if not exists stage_reason text;

alter table public.paper_bot_positions
  add column if not exists pool_id text check (pool_id is null or pool_id in ('day','multi-day','multi-week'));

create or replace function public.paper_bot_mark_to_market(p_prices jsonb,p_collected_at timestamptz)
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_item jsonb; v_symbol text; v_price numeric; v_bot text;
  v_equity numeric; v_peak numeric; v_open_risk numeric; v_daily_loss numeric; v_weekly_dd numeric;
  v_day numeric; v_multi_day numeric; v_multi_week numeric; v_updated integer := 0;
begin
  if jsonb_typeof(coalesce(p_prices,'[]'::jsonb)) <> 'array' or p_collected_at is null then
    raise exception 'Invalid mark-to-market payload';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb))
  loop
    v_symbol := nullif(v_item->>'symbol','');
    v_price := nullif(v_item->>'price','')::numeric;
    if v_symbol is null or v_price is null or v_price <= 0 then continue; end if;
    update public.paper_bot_positions
    set market_value=quantity*v_price,
        unrealized_pl=(v_price-average_entry)*quantity,
        updated_at=p_collected_at,
        metadata=metadata || jsonb_build_object(
          'markPrice',v_price,'markAt',p_collected_at,'markSource',coalesce(v_item->>'source','alpaca-data')
        )
    where symbol=v_symbol and quantity>0;
  end loop;

  for v_bot in select distinct bot_id from public.paper_bot_positions
  loop
    select l.cash + coalesce(sum(p.market_value),0),
           greatest(l.peak_equity,l.cash + coalesce(sum(p.market_value),0)),
           case when (l.cash + coalesce(sum(p.market_value),0)) > 0 then
             100 * coalesce(sum(case when p.protective_stop is not null and p.average_entry is not null
               then greatest(0,p.average_entry-p.protective_stop)*p.quantity else 0 end),0)
             / (l.cash + coalesce(sum(p.market_value),0))
           else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='day' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='multi-day' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end,
           case when (l.cash+coalesce(sum(p.market_value),0))>0 then 100*coalesce(sum(case when p.pool_id='multi-week' then p.market_value else 0 end),0)/(l.cash+coalesce(sum(p.market_value),0)) else 0 end
    into v_equity,v_peak,v_open_risk,v_day,v_multi_day,v_multi_week
    from public.paper_bot_ledgers l
    left join public.paper_bot_positions p on p.bot_id=l.bot_id
    where l.bot_id=v_bot
    group by l.bot_id,l.cash,l.peak_equity;

    select case when v_equity>0 then 100*abs(least(0,coalesce(sum(realized_pl),0)))/v_equity else 0 end
      into v_daily_loss
    from public.paper_bot_journal
    where bot_id=v_bot and event_type='filled' and occurred_at >= date_trunc('day',p_collected_at);

    select case when max(equity)>0 then greatest(0,100*(max(equity)-v_equity)/max(equity)) else 0 end
      into v_weekly_dd
    from public.paper_bot_equity_history
    where bot_id=v_bot and collected_at >= date_trunc('week',p_collected_at);

    update public.paper_bot_ledgers
    set equity=v_equity,
        unrealized_pl=coalesce((select sum(unrealized_pl) from public.paper_bot_positions where bot_id=v_bot),0),
        buying_power=greatest(cash,0),
        peak_equity=v_peak,
        current_drawdown_pct=case when v_peak>0 then least(0,(v_equity/v_peak-1)*100) else 0 end,
        open_planned_risk_pct=coalesce(v_open_risk,0),
        daily_realized_loss_pct=coalesce(v_daily_loss,0),
        weekly_drawdown_pct=coalesce(v_weekly_dd,0),
        pool_usage=jsonb_build_object('day',coalesce(v_day,0),'multi-day',coalesce(v_multi_day,0),'multi-week',coalesce(v_multi_week,0)),
        last_synced_at=p_collected_at,updated_at=now()
    where bot_id=v_bot;

    insert into public.paper_bot_equity_history(bot_id,bucket_minute,collected_at,equity,cash,realized_pl,unrealized_pl)
    select bot_id,date_trunc('minute',p_collected_at),p_collected_at,equity,cash,realized_pl,unrealized_pl
    from public.paper_bot_ledgers where bot_id=v_bot
    on conflict (bot_id,bucket_minute) do update
      set collected_at=excluded.collected_at,equity=excluded.equity,cash=excluded.cash,
          realized_pl=excluded.realized_pl,unrealized_pl=excluded.unrealized_pl;
    v_updated := v_updated+1;
  end loop;

  return jsonb_build_object('botsMarked',v_updated);
end $$;

revoke all on function public.paper_bot_mark_to_market(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.paper_bot_mark_to_market(jsonb,timestamptz) to service_role;

update public.paper_bot_ledgers
set status='active',strategy_id='three-trade-weekly-swing-v1',strategy_version=1,
    metadata=metadata || '{"executionEnabled":false,"stagingEnabled":true,"maxNewTradesPerWeek":3}'::jsonb,
    updated_at=now()
where bot_id='three-trade-weekly-swing-100';

insert into public.paper_bot_orders(
  client_order_id,bot_id,strategy_id,strategy_version,symbol,asset_class,side,status,
  requested_notional,pool_id,entry_trigger,max_entry_price,protective_stop,
  planned_risk_dollars,expires_at,stage_reason,metadata
) values
('chb-sw3-v1-20261003-qqqstage01','three-trade-weekly-swing-100','three-trade-weekly-swing-v1',1,'QQQ','etf','buy','prepared',26.599331,'multi-day',755.264510,760.112546,726.870393,1.00,'2026-10-06T00:00:00Z','Monday breakout continuation; Friday close above 10/20-day averages and near 20-day high.','{"requiresRevalidation":true,"sourceDate":"2026-10-02","setup":"breakout","maximumNewTradesPerWeek":3}'::jsonb),
('chb-sw3-v1-20261003-nvdastage1','three-trade-weekly-swing-100','three-trade-weekly-swing-v1',1,'NVDA','stock','buy','prepared',13.644193,'multi-day',238.072835,240.626942,220.624179,1.00,'2026-10-06T00:00:00Z','Monday breakout continuation; strong 5-day momentum and near 20-day high.','{"requiresRevalidation":true,"sourceDate":"2026-10-02","setup":"breakout","maximumNewTradesPerWeek":3}'::jsonb),
('chb-sw3-v1-20261003-msftstage1','three-trade-weekly-swing-100','three-trade-weekly-swing-v1',1,'MSFT','stock','buy','prepared',15.886658,'multi-day',522.982460,528.818174,490.062857,1.00,'2026-10-06T00:00:00Z','Monday continuation watch; Friday close above rising 10/20-day averages and near the recent high.','{"requiresRevalidation":true,"sourceDate":"2026-10-02","setup":"trend-continuation","maximumNewTradesPerWeek":3}'::jsonb)
on conflict (client_order_id) do nothing;
