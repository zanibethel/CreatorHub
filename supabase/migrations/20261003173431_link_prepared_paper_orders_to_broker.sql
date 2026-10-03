create or replace function public.paper_bot_link_prepared_orders(p_collected_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_count integer := 0;
begin
  if p_collected_at is null then
    raise exception 'Reconciliation timestamp is required';
  end if;

  update public.paper_bot_orders p
  set broker_order_id=o.broker_order_id,
      status=case
        when o.status='filled' then 'filled'
        when o.status='partially_filled' then 'partially_filled'
        when o.status in ('canceled','cancelled') then 'canceled'
        when o.status='rejected' then 'rejected'
        when o.status='expired' then 'expired'
        when o.status='replaced' then 'replaced'
        when o.status='closed' then 'closed'
        else 'submitted'
      end,
      submitted_at=coalesce(p.submitted_at,o.submitted_at),
      last_reconciled_at=p_collected_at,
      metadata=p.metadata || jsonb_build_object(
        'brokerObservedStatus',o.status,
        'brokerFilledQuantity',o.filled_quantity,
        'brokerAverageFillPrice',o.average_fill_price,
        'brokerLastSeenAt',o.last_seen_at
      ),
      updated_at=now()
  from public.paper_bot_broker_orders o
  where p.client_order_id=o.client_order_id
    and p.bot_id=o.bot_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.paper_bot_link_prepared_orders(timestamptz)
  from public,anon,authenticated;
grant execute on function public.paper_bot_link_prepared_orders(timestamptz)
  to service_role;
