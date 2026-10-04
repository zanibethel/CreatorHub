# PAPER Prospect Scanner

Status: active research scanner; PAPER-only discovery; no order authority.

## Purpose

The Prospect Scanner is a separate discovery service that searches outside the bots' existing watchlists for symbols that may be developing into higher-quality setups.

It does not place orders and it does not automatically expand a trading bot's execution universe. Its job is to find interesting symbols early, score them consistently, persist the evidence, and hand sufficiently strong prospects to the next bot-review stage.

Scanner ID: `paper-prospect-scanner-v1`

## Promotion levels

The scanner uses a separate Prospect Score from 0 to 100.

- Below 40: not retained as scanner evidence.
- 40–64.99: observation evidence only.
- 65–79.99: added to the Prospect Watchlist.
- 80–100: marked Bot Review Ready and given suggested bot destinations.

These thresholds are discovery thresholds, not trading thresholds. After a prospect reaches Bot Review Ready, the receiving bot must independently run its own strategy score, setup, liquidity, risk, portfolio, entry, stop, exit, and execution gates.

## Discovery universe

### Stocks

Every ten minutes, the scanner combines:

- Alpaca top stock gainers.
- Alpaca top 100 stocks by volume.
- Alpaca stock snapshots for price, quote/spread, session volume, prior-day volume, and distance from the session high.
- Alpaca asset validation before a prospect can enter the Prospect Watchlist.

Stock market source data must be fresh. On weekends or other periods where the stock screener is stale, the scanner skips new stock promotion instead of repeatedly treating the prior session as current.

### Crypto

The scanner reads Alpaca's active, tradable, fractionable crypto asset catalog and evaluates all USD pairs rather than only the Daily Crypto bot's current fixed universe.

For those pairs it reads Alpaca crypto snapshots and measures:

- current session percentage change,
- current-versus-prior-day volume expansion,
- quoted spread,
- distance from the session high,
- whether the symbol is also a top crypto gainer.

Crypto quotes must be fresh before evaluation.

## Prospect Score

The score intentionally rewards conditions that can precede a stronger normal bot score.

Stock components:
- positive session momentum / percentage change,
- most-active rank,
- tradability/liquidity quality,
- volume expansion versus the prior day,
- proximity to the current session high.

Crypto components:
- positive session momentum / percentage change,
- spread/liquidity quality,
- volume expansion versus the prior day,
- proximity to the current session high.

The Prospect Score does not replace the strategy score used by any trading bot.

## Suggested bot review

A score of 80 or higher automatically places the prospect into the appropriate bot review queue. This is a review assignment only; it does not make the symbol execution-eligible.

Current routing suggestions:

- Crypto: Daily Crypto and Default Diverse.
- Stock above the penny ceiling: Default Diverse and Weekly Swing.
- Stock at or below $5: Penny Volatility and Default Diverse.

The Penny Volatility bot remains planned/disabled. A scanner suggestion does not activate it.

`suggested_bot_ids` records the routing logic and `assigned_bot_ids` records the bot review queues that actually received a score-80 prospect. Assignments are durable evidence even if the prospect later cools off.

## Persistence

Current state lives in `paper_prospects`.

Each scan above the observation floor is appended to `paper_prospect_observations` so later strategy review can answer questions such as:

- Which prospects later became high-scoring trade setups?
- Which volume spikes faded immediately?
- Which percentage movers were too illiquid or too wide-spread?
- What Prospect Score bands most often preceded successful trades?
- Did a bot miss a profitable symbol because it was not yet in its fixed universe?

Crypto prospects expire after two hours without being seen. Stock prospects expire after 36 hours without being seen. Expired records remain available historically through observations.

## Dashboard

Bot Lab includes a global **Prospects** view showing:

- Prospect Score,
- price,
- session percentage change,
- volume ratio,
- spread,
- distance from session high,
- activity rank for stocks,
- suggested next bot review,
- whether the symbol is new or already monitored.

A second section shows near-miss prospects within ten points of the Prospect Watchlist threshold.

## Safety boundary

The scanner is discovery-only.

It cannot:
- place an Alpaca order,
- mark a candidate READY for a trading bot,
- bypass a bot's strategy threshold,
- expand the Daily Crypto execution whitelist,
- activate the Penny Volatility bot,
- change position sizing or risk limits.

The receiving bot remains the final strategy authority for any PAPER trade.
