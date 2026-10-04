update public.paper_bot_ledgers
set source='virtual-ledger+execution-audit',
    updated_at=now()
where source='virtual-ledger+alpaca-audit';
