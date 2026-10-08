# Trading Bot Roster

Status: active product architecture
Last updated: 2026-10-08

Each bot owns a distinct setup class and an isolated virtual $100 ledger. The scanner may surface the same symbol to multiple strategies when the setup legitimately fits multiple horizons, but each bot must qualify it independently. A rejection by one bot is not a global rejection.

Live-money execution is disabled across the entire program.

| Bot | Codename | Role | Typical horizon | Production simulation state |
|---|---|---|---|---|
| Default Diverse | **Atlas** | Diversified generalist | intraday to multi-week | evidence/review |
| Penny Volatility | **Fuse** | $0.08–$5 early volatility / momentum | intraday | active research / orders disabled |
| Weekly Swing | **Harbor** | selective trend continuation / breakout | multi-day | automatic |
| Crypto Swing | **Orbit** | selective crypto swing | 1–7 days | evidence/review |
| Squeeze Breakout | **Coil** | compression + volume ignition | intraday to several sessions | evidence/review |
| Daily Crypto | **Flash** | confirmed crypto momentum | short horizon, 24/7 | automatic |
| Stock Momentum Breakout | **Pulse** | fast stock continuation/reversal breakout | intraday | automatic |
| Crypto Ignition | **Spark** | early fast crypto momentum before slower confirmation | short horizon, 24/7 | automatic |

## Atlas — Diversified Generalist

**Job:** broad portfolio-style strategy and legacy general decision engine.

Atlas should not become the catch-all place where specialized setup rules are added. When a repeatable setup class develops enough evidence, it should graduate into a purpose-built bot.

## Fuse — Penny Volatility

**Job:** isolate the unusual liquidity, spread, sizing, and volatility behavior of stocks from roughly $0.08 to $5.

Fuse v1 is live for independent *research-only* scanner scoring, five-minute market-data checks, rejected prospect journaling and isolated $100 virtual-equity review. Broker submission and intraday close-flat management are **not armed**. See [Fuse research strategy](PAPER_FUSE_PENNY_VOLATILITY.md). Penny-stock rules must not be weakened into Pulse.

## Harbor — Weekly Swing

**Job:** selective multi-day trend continuation and breakout trades.

Harbor requires stronger daily trend structure, including positive multi-day context. It should continue rejecting intraday reversal/momentum names that lack that structure even when another bot can trade them.

Core protections:
- maximum three new entries per week
- maximum three open positions
- 1% virtual-equity risk budget per trade
- 30% maximum allocation
- fresh same-session quote/spread/chase/risk revalidation
- broker-hosted simulated bracket protection

## Orbit — Crypto Swing

**Job:** multi-hour/multi-day crypto opportunities.

Orbit remains an evidence/review strategy until its execution path is deliberately armed.

## Coil — Squeeze Breakout

**Job:** compressed bases where renewed volume may trigger asymmetric upside.

Coil owns compression/base logic rather than generic momentum. It remains evidence/review until its execution path is deliberately armed.

## Flash — Confirmed Crypto Momentum

**Job:** higher-confidence short-horizon crypto after fast and slower confirmation agree.

Flash should remain strict. The refusal study showed that simply lowering its score/trend requirements would also admit setups that later failed.

Primary distinction:
- Flash owns the **80+ confirmed tier**.
- Spark owns the **60–79 early-ignition tier** when its independent fast gates pass.

## Pulse — Stock Momentum Breakout

**Job:** capture scanner-qualified intraday stock moves that Harbor correctly rejects because they do not yet have favorable multi-day trend structure.

Pulse was created from observed scanner examples such as SNXX/MUU-style moves.

Pulse requires:
- Prospect Scanner v3 score 80+
- stock price >= $5
- fresh prospect (<=20 minutes)
- acceleration score >=15
- chase penalty <=8
- live spread <=0.35%
- fresh quote
- enough completed 5-minute bars
- short-horizon breakout confirmation
- positive fast momentum
- relative-volume ignition
- acceptable ATR / stop distance

Risk/execution:
- intraday only
- maximum three new entries/day
- maximum two open positions
- 0.5% planned virtual-equity risk/trade
- 25% allocation cap
- 1% open-risk ceiling
- simulated broker-hosted bracket protection
- one automatic submission at a time through the runner
- source candidate and rejected/waiting outcomes persisted for later counterfactual review

## Spark — Crypto Ignition

**Job:** test the exact gap found in the crypto refusal analysis: useful fast moves can begin while Flash is still waiting for 15-minute confirmation.

Spark does not lower Flash's threshold. It is a separate strategy.

Spark requires:
- Flash source score between 60 and 79
- score 80+ automatically graduates to Flash instead
- fresh quote
- spread <=0.15%
- fast 5-minute momentum
- short-horizon breakout
- relative-volume ignition
- acceptable fast ATR
- chase protection

Risk/execution:
- 24/7
- maximum three new entries/accounting day
- one open Spark position
- 0.35% planned virtual-equity risk/trade
- 20% allocation cap
- 0.5% open-risk ceiling
- marketable-limit simulated entry
- immediate protective stop-limit
- emergency flatten if protection cannot be established
- protect at +1R
- take 50% at +2R
- trail remaining protection
- 60–79 non-trades are counterfactually tracked so we can compare misses vs avoided losses

## Routing rules

A scanner discovery is not an order.

Current stock routing:
- $0.08–$5 candidates: Atlas / Fuse research lane as applicable
- non-penny review-ready stock candidates: Atlas + Pulse + Harbor
- each strategy independently accepts or rejects the setup

Current crypto routing:
- Flash computes the confirmed readiness score
- 80+ stays with Flash
- 60–79 can be considered by Spark, but only if Spark's fast independent gates pass
- Orbit remains the longer-horizon crypto lane

## Product rule

Bot specialization is preferred over weakening a strategy to cover a different setup class.

When a refusal repeatedly precedes good moves:
1. determine whether the refusing bot was wrong **for its own strategy**, or whether the move belongs to a different strategy;
2. validate against real traded bars rather than wide-spread midpoint snapshots;
3. create/tune a separate strategy only when evidence shows a repeatable setup class;
4. preserve the original bot's risk rules unless its own counterfactual evidence supports changing them.

This keeps the visual product honest: users can see not only that a symbol was found, but which bot considered it, why one bot rejected it, why another accepted it, and what happened afterward.
