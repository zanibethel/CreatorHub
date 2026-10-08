# Flash forensic review — October 8, 2026

Scope: `weekend-crypto-day-100` (Flash), `wkd`, isolated $100 PAPER virtual ledger only. Production baseline commit: `75bdffccda75670a8db21b4577bed63c2fc0cb7e`. Source of truth: production Supabase `paper_bot_counterfactuals`, matched contemporaneous `paper_bot_journal`, `paper_bot_ledgers` and `paper_bot_performance_audit_v1`.

## Baseline

- Flash active on `daily-crypto-day-v5` with `executionEnabled=true`, `liveMoneyEnabled=false`.
- Seven-day audit: 17,110 repeated candidate checks, 670 rejected journal events, **0 authorized events**, **0 broker buy orders**, **0 filled buys**, **0 closed trades** and **$0 realized P/L**. $100 cash and equity, $100 buying power, no open planned or correlated risk at review time.
- 26 settled candle counterfactuals: 6 +2R before stop, 11 stop before +1R, 9 +1R then stop. These are studies, not executed orders or independent trade evidence.
- All six historical +2R studies had contemporaneous journals identifying *waiting* qualification, **score below 80**, and `selectedForSubmission=false`. No evidence establishes an authorized broker submission or a verified missed executable winning trade.

## Six original decisions (timestamps UTC)

| Case | Original decision | Version | Score | Original rejected/waiting checks | Outcome |
| --- | --- | --- | --- | --- | --- |
| #3 DOT/USD | 2026-10-04 05:30:39 | v4 | 65 | 0.199% spread >0.15%, 15m momentum below threshold, breakout not triggered, score <80 | Later +2R candle; valid original rejection |
| #5 LINK/USD | 2026-10-04 05:40:38 | v4 | 60 | 0.220% spread >0.15%, incomplete 15m history, weak trend/momentum, price beyond max chase, score <80 | Later +2R candle; valid original rejection |
| #4 BTC/USD | 2026-10-04 05:40:38 | v4 | 75 | Weak 5m momentum, ATR 0.035% below 0.08% lower bound, score <80 | Later +2R candle; valid original rejection |
| #225 DOT/USD | 2026-10-06 05:00:38 | v5 | 60 | 0.163% spread, incomplete 15m history, misaligned trend/momentum, max chase violated, score <80, forecast 2.33% <5% goal | Later +2R candle; valid original rejection |
| #226 LINK/USD | 2026-10-06 05:10:38 | v5 | 60 | 0.206% spread, incomplete 15m history, misaligned trend/momentum, max chase violated, score <80, forecast 1.60% <5% goal | Later +2R candle; valid original rejection |
| #227 SOL/USD | 2026-10-06 06:40:38 | v5 | 65 | Quote age 89.3s >60s freshness, incomplete 15m history, BTC regime not supportive, trend/momentum and chase failed, score <80, forecast 1.60% <5% goal | Later +2R candle; valid original rejection |

The matched decision records were **all execution-tier** candidates, within open 24/7 entry sessions, with execution permission enabled. Warnings, not insufficient cash, barred the original entries. `blockers=[]` here refers to hard ledger/risk blockers: mandatory market and technical qualifications are separately recorded in `warnings`; absence of a hard blocker is NOT entry authorization. Initial capital was available, but irrelevant to the rejected orders.

### Historical model limitations (not corrected by hindsight)

- `+2R` is a hypothetical price-level observation on 5-minute OHLC bars, **not** the v5 goal exit. For v5, a projected opportunity of at least 5% is a separate mandatory gate.
- The counterfactual entry is an assumed trigger/candle fill. It is not an Alpaca broker fill. Candle high/low alone cannot prove that a tradeable ask could have filled at or below the allowed entry limit, or that a corresponding exit at a tradeable bid would have been fillable.
- No contemporaneous future bid/ask tape, depth/queue, partial-fill evidence, venue slippage, or broker order acknowledgements exist for these unsubmitted orders. Fee estimates in decision journals do not establish net realized results.
- Original code versions **v4** and **v5** must remain separate; the v5 5%-goal condition did not exist in v4. The time a future bar first touched +2R must not be used to alter the original score, momentum, spread, ATR, freshness, target, or authorization.
- Historical candle timestamps can refer to **bar starts**; they are not necessarily the time a tradeable price became known. The shadow tracker flags some same-bar stop/target ambiguities, but the six +2R labels are not executable backtests.

## Additional current-v5 evidence

- 1,036 total historical Flash candidate **evaluations** scored >=80 across all tiers/versions in the audited full journal; zero journaled `state=ready` and zero `selectedForSubmission=true`. A high score alone does not authorize entry.
- Three recorded recent BTC/USD evaluations scored 100, yet projected only 1.75%, 1.86%, and 2.64%—below v5's separately required 5% opportunity threshold.
- In the most recent 24-hour execution-tier sample, the `15-minute history insufficient` warning was frequent. This may reflect data continuity/symbol liquidity and deserves monitoring, but the current evidence does not justify bypassing bar-history confirmation or asserting a provider defect.
- `vercel.json` configures Flash's runner every five minutes, every day. Source routing checks readiness before manager/executor and executor revalidates strategy, symbol selection, quote freshness, risk plan, and broker conflicts. No matched case reached the executor.

## Resolution

**Confirmed original decision root cause:** mandatory entry qualification, not demonstrated candidate handoff or broker-routing failure. **Verified missed executable winners among these cases:** 0. **Unproven hypothetical +2R scenarios:** 6. Strategy performance remains unmeasured (zero completed trades), not a 0% win rate.

**Safe implementation:** add a read-only Flash per-case Performance Audit view with contemporaneous journal match, strategy version, original quote, planned entry/stop/goal, risks and warning reasons. Mark missing/mismatched evidence unresolved; never count future price reach as executable profit. Add regression tests. This does not affect strategy, routes, risk, broker, capital, or other bots.

**Proposals requiring separate approval and out-of-sample evidence:** test whether the 5% projected goal is too restrictive for intended holding horizons; inspect data provider pagination/completeness and 15m-bar freshness; study spread/chase/candidate watch re-evaluation under transaction-cost assumptions. No thresholds are changed by this review.

## Reproducibility

```sql
SELECT id,symbol,decision_at,strategy_id,strategy_version,score,decision_state,
       first_outcome,trigger_price,max_entry_price,protective_stop,
       assumed_entry_price,one_r_price,two_r_price,triggered_at,two_r_hit_at,
       warnings,metadata
FROM public.paper_bot_counterfactuals
WHERE bot_id='weekend-crypto-day-100'
  AND status='completed' AND first_outcome='two-r-before-stop'
ORDER BY decision_at;

SELECT * FROM public.paper_bot_performance_audit_v1
WHERE bot_id='weekend-crypto-day-100';
```

The drill-down joins each shadow to its same-symbol journal at the recorded decision timestamp within 1.5 seconds and refuses a validated-win label when that match is missing. No historical rows, bot ledgers, broker orders, or P/L were edited.
