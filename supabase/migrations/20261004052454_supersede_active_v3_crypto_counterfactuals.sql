update public.paper_bot_counterfactuals
set status='superseded',
    first_outcome=coalesce(first_outcome,'strategy-version-superseded'),
    metadata=metadata || jsonb_build_object(
      'supersededByStrategyId','daily-crypto-day-v4',
      'supersededByStrategyVersion',4,
      'supersedeReason','Active v3 counterfactual closed at the v4 continuous-session promotion boundary so outcome rules remain version-pure.',
      'supersededAt',now()
    ),
    updated_at=now()
where bot_id='weekend-crypto-day-100'
  and strategy_version < 4
  and status in ('watching','triggered');
