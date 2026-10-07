# PAPER Prospect Scanner

Status: active research scanner; simulated-trading discovery only; no order authority.

## Purpose

The Prospect Scanner is a separate discovery service that searches outside the bots' existing watchlists for symbols that may be developing into higher-quality setups.

It does not place orders and it does not automatically expand a trading bot's execution universe. Its job is to find interesting symbols early, score them consistently, persist the evidence, and hand sufficiently strong prospects to the next bot-review stage.

Scanner ID: `paper-prospect-scanner-v3`

## Promotion levels

The scanner uses a separate Prospect Score from 0 to 100.

- Below 40: not retained as scanner evidence.
- 40–64.99: observation evidence only.
- 65–79.99: added to the Prospect Watchlist.
- 80–100: marked Bot Review Ready and given suggested bot destinations.

These thresholds are discovery thresholds, not trading thresholds. After a prospect reaches Bot Review Ready, the receiving bot must independently run its own strategy score, setup, liquidity, risk, portfolio, entry, stop, exit, and execution gates.

## Discovery universe

### Stocks

Every five minutes, the scanner combines:

- Top stock gainers from the configured market-data screener during the regular session.
- Top 100 stocks by volume when that source is fresh.
- Symbols attached to recent market-news articles, which gives the scanner a premarket discovery path before the regular-session movers list resets.
- Stock market snapshots for price, quote/spread, session volume, prior-day volume, session-open gap, and distance from the session high.
- Recent one-minute bars used to measure 5-, 15-, and 60-minute acceleration.
- Market-catalog validation before a prospect can enter the Prospect Watchlist.

The regular stock-movers endpoint does not become a current-day movers list until the opening bell, so v3 does not depend on it for premarket discovery. Stale mover/activity sources are ignored independently rather than blocking fresh news-led candidates.

### Crypto

The scanner reads the configured active, tradable, fractionable crypto asset catalog and evaluates all USD pairs rather than only the Daily Crypto bot's current fixed universe.

For those pairs it reads crypto market snapshots and measures:

- current session percentage change,
- current-versus-prior-day volume expansion,
- quoted spread,
- distance from the session high,
- whether the symbol is also a top crypto gainer.

Crypto quotes must be fresh before evaluation.

## Prospect Score

The score intentionally rewards conditions that can precede a stronger normal bot score.

Stock components:
- positive session momentum / percentage change, with diminishing credit once most of a very large move has already happened,
- most-active rank,
- tradability/liquidity quality,
- consolidated session-volume expansion versus the prior day when available,
- proximity to the current session high,
- 5-, 15-, and 60-minute acceleration,
- freshness of a market-news catalyst when price action confirms it,
- a chase-risk penalty when a stock is already up roughly 15%+ without fresh continuation.

Crypto components:
- positive session momentum / percentage change,
- spread/liquidity quality,
- volume expansion versus the prior day,
- proximity to the current session high.

The Prospect Score does not replace the strategy score used by any trading bot.

## Suggested bot review

A score of 80 or higher automatically places the prospect into the appropriate bot review queue. This is a review assignment only; it does not make the symbol execution-eligible.

Current routing suggestions:

- Crypto: Daily Crypto, Crypto Swing, and Default Diverse.
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
- place a PAPER execution order,
- mark a candidate READY for a trading bot,
- bypass a bot's strategy threshold,
- expand the Daily Crypto execution whitelist,
- activate the Penny Volatility bot,
- change position sizing or risk limits.

The receiving bot remains the final strategy authority for any PAPER trade.


## v3 timing lesson from OPCH — October 6, 2026

OPCH exposed the difference between detecting a strong stock and detecting an actionable move early.

The old scanner first retained OPCH at about 9:40 ET, when it was already roughly 33% above the prior close and trading close to the level it held for most of the regular session. Historical premarket data and market-news timestamps showed that OPCH was already active hours earlier.

v3 therefore treats a large completed gap differently from a fresh breakout. A large session gain by itself no longer earns maximum momentum credit. A candidate can regain high priority when recent 5/15/60-minute acceleration, consolidated activity, and a fresh catalyst show that a new leg is actually developing.

This keeps late movers visible as research evidence while making the 80+ review-ready band more representative of remaining opportunity instead of merely confirming that a move already happened.
