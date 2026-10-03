create or replace function public.paper_bot_reconcile_broker_activity(
  p_orders jsonb,
  p_fills jsonb,
  p_collected_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_orders integer := 0;
  v_fills integer := 0;
  v_submitted integer := 0;
  v_fill_events integer := 0;
begin
  if jsonb_typeof(coalesce(p_orders,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_fills,'[]'::jsonb)) <> 'array'
     or p_collected_at is null then
    raise exception 'Invalid broker reconciliation payload';
  end if;

  insert into public.paper_bot_broker_orders(
    broker_order_id,client_order_id,bot_id,strategy_id,strategy_version,
    symbol,asset_class,side,order_type,order_class,status,quantity,
    filled_quantity,average_fill_price,submitted_at,filled_at,last_seen_at,metadata
  )
  select
    left(item->>'brokerOrderId',80),
    left(item->>'clientOrderId',128),
    l.bot_id,
    l.strategy_id,
    nullif(substring(item->>'clientOrderId' from '^chb-[a-z0-9]{2,12}-v([1-9][0-9]*)-'),'')::integer,
    left(item->>'symbol',32),
    case when item->>'assetClass' in ('stock','etf','crypto') then item->>'assetClass' else 'unknown' end,
    case when lower(item->>'side')='sell' then 'sell' else 'buy' end,
    nullif(left(item->>'orderType',40),''),
    nullif(left(item->>'orderClass',40),''),
    left(coalesce(item->>'status','unknown'),40),
    nullif(item->>'quantity','')::numeric,
    nullif(item->>'filledQuantity','')::numeric,
    nullif(item->>'averageFillPrice','')::numeric,
    nullif(item->>'submittedAt','')::timestamptz,
    nullif(item->>'filledAt','')::timestamptz,
    p_collected_at,
    jsonb_build_object('source','alpaca-paper','attribution','client-order-id')
  from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) item
  join public.paper_bot_ledgers l
    on l.broker_tag = substring(item->>'clientOrderId' from '^chb-([a-z0-9]{2,12})-v[1-9][0-9]*-[a-z0-9]+-[a-z0-9]{6,24}$')
  where coalesce(item->>'brokerOrderId','') <> ''
    and coalesce(item->>'clientOrderId','') <> ''
    and coalesce(item->>'symbol','') <> ''
  on conflict (broker_order_id) do update set
    client_order_id=excluded.client_order_id,
    bot_id=excluded.bot_id,
    strategy_id=excluded.strategy_id,
    strategy_version=excluded.strategy_version,
    symbol=excluded.symbol,
    asset_class=excluded.asset_class,
    side=excluded.side,
    order_type=excluded.order_type,
    order_class=excluded.order_class,
    status=excluded.status,
    quantity=excluded.quantity,
    filled_quantity=excluded.filled_quantity,
    average_fill_price=excluded.average_fill_price,
    submitted_at=excluded.submitted_at,
    filled_at=excluded.filled_at,
    last_seen_at=excluded.last_seen_at;
  get diagnostics v_orders = row_count;

  insert into public.paper_bot_broker_fills(
    fill_activity_id,broker_order_id,bot_id,symbol,side,quantity,price,
    cumulative_quantity,leaves_quantity,transaction_time
  )
  select
    left(item->>'fillActivityId',160),
    left(item->>'brokerOrderId',80),
    o.bot_id,
    left(item->>'symbol',32),
    case when lower(item->>'side')='sell' then 'sell' else 'buy' end,
    (item->>'quantity')::numeric,
    (item->>'price')::numeric,
    nullif(item->>'cumulativeQuantity','')::numeric,
    nullif(item->>'leavesQuantity','')::numeric,
    (item->>'transactionTime')::timestamptz
  from jsonb_array_elements(coalesce(p_fills,'[]'::jsonb)) item
  join public.paper_bot_broker_orders o
    on o.broker_order_id = item->>'brokerOrderId'
  where coalesce(item->>'fillActivityId','') <> ''
    and nullif(item->>'quantity','')::numeric > 0
    and nullif(item->>'price','')::numeric > 0
    and nullif(item->>'transactionTime','') is not null
  on conflict (fill_activity_id) do nothing;
  get diagnostics v_fills = row_count;

  insert into public.paper_bot_journal(
    bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    broker_order_id,client_order_id,quantity,metadata
  )
  select
    o.bot_id,o.strategy_id,o.strategy_version,'submitted',o.symbol,o.asset_class,
    coalesce(o.submitted_at,o.last_seen_at),o.broker_order_id,o.client_order_id,o.quantity,
    jsonb_build_object('side',o.side,'status',o.status,'orderType',o.order_type,'orderClass',o.order_class,'source','alpaca-paper')
  from public.paper_bot_broker_orders o
  where o.last_seen_at = p_collected_at
    and not exists (
      select 1 from public.paper_bot_journal j
      where j.bot_id=o.bot_id and j.event_type='submitted' and j.client_order_id=o.client_order_id
    )
  on conflict do nothing;
  get diagnostics v_submitted = row_count;

  insert into public.paper_bot_journal(
    bot_id,strategy_id,strategy_version,event_type,symbol,asset_class,occurred_at,
    broker_order_id,client_order_id,entry_price,exit_price,quantity,metadata
  )
  select
    f.bot_id,o.strategy_id,o.strategy_version,'filled',f.symbol,o.asset_class,f.transaction_time,
    f.broker_order_id,o.client_order_id,
    case when f.side='buy' then f.price else null end,
    case when f.side='sell' then f.price else null end,
    f.quantity,
    jsonb_build_object(
      'fillActivityId',f.fill_activity_id,'side',f.side,'cumulativeQuantity',f.cumulative_quantity,
      'leavesQuantity',f.leaves_quantity,'source','alpaca-paper'
    )
  from public.paper_bot_broker_fills f
  join public.paper_bot_broker_orders o on o.broker_order_id=f.broker_order_id
  where not exists (
    select 1 from public.paper_bot_journal j
    where j.event_type='filled' and j.metadata->>'fillActivityId'=f.fill_activity_id
  )
  on conflict do nothing;
  get diagnostics v_fill_events = row_count;

  update public.paper_bot_ledgers l
  set last_synced_at=p_collected_at,
      source='virtual-ledger+alpaca-audit',
      updated_at=now()
  where exists (
    select 1 from public.paper_bot_broker_orders o
    where o.bot_id=l.bot_id and o.last_seen_at=p_collected_at
  );

  return jsonb_build_object(
    'ordersSeen',v_orders,
    'fillsAdded',v_fills,
    'submittedEventsAdded',v_submitted,
    'fillEventsAdded',v_fill_events
  );
end $$;

revoke all on function public.paper_bot_reconcile_broker_activity(jsonb,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.paper_bot_reconcile_broker_activity(jsonb,jsonb,timestamptz)
  to service_role;
