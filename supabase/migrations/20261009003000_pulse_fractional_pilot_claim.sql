-- Atomic, one-time gate for Pulse's initial real Alpaca PAPER fractional test.
-- A broker order is not submitted until the claim commits; a failed/ambiguous
-- claim stops submission, preventing simultaneous cron runs from doubling risk.
create or replace function public.paper_pulse_claim_fractional_pilot(p_client_order_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_affected integer := 0;
begin
  if p_client_order_id is null or
     p_client_order_id !~ '^chb-pls-v1-[a-z0-9]+-[a-z0-9]{6,24}$'
     then return false;
  end if;
  update public.paper_bot_ledgers
  set metadata = jsonb_set(metadata, '{fractionalPilotClientOrderId}',
                           to_jsonb(p_client_order_id), true),
      updated_at = now()
  where bot_id = 'momentum-breakout-100'
    and status = 'active'
    and metadata->>'executionEnabled' = 'true'
    and metadata->>'fractionalExecutionEnabled' = 'true'
    and not metadata ? 'fractionalPilotClientOrderId';
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end
$$;

revoke all on function public.paper_pulse_claim_fractional_pilot(text)
  from public, anon, authenticated;
grant execute on function public.paper_pulse_claim_fractional_pilot(text)
  to service_role;
