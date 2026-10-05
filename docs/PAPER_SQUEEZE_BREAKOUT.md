# PAPER Squeeze Breakout Bot

Status: active PAPER research bot; dedicated scanner active; broker execution disabled.

## Purpose

The Squeeze Breakout strategy studies stocks that spend an extended period in a quiet, compressed base and then begin showing renewed volume as price approaches or breaks the top of that base.

This is deliberately described as a **squeeze-like breakout** rather than automatically as a short squeeze. Version 1 does not yet use authoritative short-interest, days-to-cover, utilization, borrow-rate, or locate data. Those can be added later as confirmation features.

Bot ID: `squeeze-breakout-100`  
Strategy ID: `squeeze-breakout-v1`  
Scanner ID: `paper-squeeze-scanner-v1`  
Broker attribution tag: `sqz`

## Capital isolation

- Starting virtual capital: **$100**.
- Separate ledger, cash, equity, P/L, risk budget, positions, orders, fills, and evidence.
- The PAPER execution venue is shared infrastructure only.
- This is the sixth reserved $100 pool in the $1,000 PAPER program.
- Six pools now reserve $600; $400 remains unallocated.

## Discovery model

The dedicated scanner is separate from the broad Market Prospect Scanner. It runs on stock candidates sourced from current gainers, most-active names, and already-tracked squeeze prospects.

Version 1 uses completed daily history to measure an extended base and live session data to detect ignition.

Core evidence:
- approximately 40 completed trading days for the active base window,
- at least 45 completed bars available,
- base high / base low and base-range percentage,
- where the pre-ignition close sits inside the base,
- recent base volume versus the prior base volume,
- live volume pace relative to normal volume,
- current price distance from the base high,
- current session price change,
- spread and average dollar-volume quality.

The scanner initially considers stocks between **$0.50 and $50**, requires at least **$1 million average daily dollar volume**, and rejects spreads wider than **1.25%** for qualified discovery.

## Pace-adjusted relative volume

Raw partial-day volume is not compared directly with a full normal day. During the regular session, current volume is divided by the expected fraction of normal daily volume based on elapsed New York trading-session time.

For example, a name running at roughly twice its normal pace early in the session can register about **2× relative-volume pace** before its raw volume has reached two full average days of volume.

This is intended to catch ignition early rather than after the move is already mature.

## Squeeze Scanner Score

The scanner has its own 0–100 discovery score. It does not authorize a trade.

| Component | Maximum |
| --- | ---: |
| Base compression | 25 |
| Position within the base before ignition | 20 |
| Historical volume dryness | 15 |
| Current volume ignition | 20 |
| Breakout structure | 15 |
| Liquidity / spread | 5 |

Promotion:
- Below 40: not retained as meaningful scanner evidence.
- 40–64.99: observation evidence.
- 65–79.99: Squeeze Watchlist.
- 80–100: Squeeze Bot Review Ready.

## Bot readiness score

After discovery, the Squeeze Breakout bot independently scores the candidate again.

Bot score components:
- scanner evidence quality,
- current relative-volume pace,
- current relationship to the base-high breakout,
- controlled positive session momentum,
- liquidity and spread quality.

Ladder:
- 70+: WATCHING.
- 80+: QUALIFIED.
- 85+: READY-quality, subject to every hard gate.

A READY-quality candidate must also:
- break at least 0.25% above the stored base high,
- remain no more than 5% above the base high so the bot does not chase an already-extended move,
- reach at least 2× normal relative-volume pace,
- have a current session move of at least 0.5% but no more than 12%,
- have a fresh quote,
- remain within the spread limit,
- pass virtual buying-power, open-position, open-risk, base-quality, and liquidity checks.

During initial v1 research, broker execution remains disabled. A setup that otherwise passes is kept as qualified evidence/reference-plan data rather than being submitted.

## Reference trade plan

The first reference plan intentionally uses controlled downside against the asymmetric upside thesis:

- Entry reference: base high + 0.25%.
- Maximum initial allocation: 30% of bot equity.
- Planned-loss budget: 1% of bot equity.
- Stop distance: derived from base width and clamped to 4–8%.
- Maximum open planned risk: 2%.
- Maximum open positions: 2.
- Maximum new entries per day: 2.
- Intended hold: intraday through about five sessions.

## Opportunity management

The user's hypothesis is that a successful ignition can produce roughly **20–30% upside**. Version 1 records that as an opportunity zone rather than an expected return.

Reference management:
- +15%: partial-profit reference on 50% of the position.
- +25%: primary reference target.
- +20–30%: opportunity zone used for study and comparison.
- Remainder: eligible to trail rather than assuming a fixed final exit.

The strategy must still record misses, failed breakouts, stop-outs, maximum favorable excursion, maximum adverse excursion, and counterfactual outcomes. A large target does not justify widening the stop or increasing the risk budget.

## Persistence

Private service-role PAPER storage:
- `paper_squeeze_prospects` — current scanner state.
- `paper_squeeze_observations` — historical scanner observations.
- `paper_bot_ledgers` — isolated bot accounting.
- standard bot positions, orders, fills, trade metrics, journal, and equity-history tables once lifecycle activity exists.

The squeeze tables have RLS enabled and no anonymous/authenticated access. Public Bot Portfolio data is exposed only through safe server-side projections.

## Scheduling

Vercel schedules:
- scanner: every 15 minutes Monday through Friday,
- readiness evaluation: every 5 minutes Monday through Friday.

The scanner rejects stale stock-screener input rather than treating an old session as fresh discovery. This is especially important on weekends and market holidays.

## Future confirmation layer

Potential future additions, if reliable data access is available:
- short interest as a percentage of float,
- days to cover,
- borrow utilization / borrow fee,
- float size,
- shares available to borrow,
- options call/put pressure,
- news/catalyst classification,
- intraday VWAP reclaim and premarket/high-of-day structure.

Those features should improve confidence and ranking; they should not weaken the current risk controls or convert a scanner score directly into order permission.
