# CreatorHub Live Market Data

## Architecture

CreatorHub uses live market data for research, scanners, watchlists, and readiness checks while keeping execution simulated.

- Preferred live U.S. equity quotes: Tradier Brokerage production market-data API.
- Fallback live U.S. equity quotes: Alpaca IEX.
- Completed U.S. equity daily history: Alpaca SIP.
- Crypto live data: existing Kraken/crypto market-data routes.
- Simulated execution and broker evidence: Alpaca paper environment.
- Real-money execution: disabled and intentionally outside this configuration.

## Tradier setup

CreatorHub reads the server-only environment variable:

`TRADIER_ACCESS_TOKEN`

Use a Tradier **production** token, not a sandbox token. Tradier production provides real-time consolidated U.S. equity data; sandbox market data is delayed.

The token must be stored only as a server-side sensitive environment variable. Never expose it through `NEXT_PUBLIC_*` variables or client code.

Recommended Vercel targets:

- Production
- Preview

After the variable is present, no code toggle is required. The shared market-data adapter automatically prefers Tradier. If a Tradier request fails, it records the provider error and falls back to Alpaca IEX so the dashboard and scanners remain available.

## Current consumers

Tradier-first live quotes feed:

- Trading Lab watchlist/current quotes
- General Market Prospect Scanner
- Squeeze Breakout Scanner
- Squeeze Breakout readiness
- Swing readiness

Completed SIP daily history is used for stock chart/scanner history where applicable so historical liquidity and volume are not based only on IEX.

## Source provenance

API responses include market-data provenance such as:

- `tradier-consolidated`
- `alpaca-iex`
- `alpaca-sip-completed`

Squeeze and prospect observations persist the source/fallback information in metadata when available.

## Execution boundary

Adding `TRADIER_ACCESS_TOKEN` does **not** enable Tradier trading and does not enable live-money execution.

Tradier is market-data-only in CreatorHub. Simulated order execution remains routed through the existing Alpaca paper workflow and CreatorHub virtual ledgers.
