# Weekend Crypto Day Bot — superseded

This document describes the original weekend-only v1 concept.

The active strategy is now **Daily Crypto Day v3**, which preserves the stable bot ID `weekend-crypto-day-100` and broker tag `wkd` for attribution/history continuity while allowing eligible intraday crypto sessions seven days a week.

Daily Crypto Day v3 uses two tiers:
- execution-eligible: BTC/USD, ETH/USD, SOL/USD, LINK/USD, DOT/USD
- monitor-only: XRP/USD, LTC/USD, AVAX/USD, DOGE/USD, ADA/USD, BCH/USD, AAVE/USD, HYPE/USD, RENDER/USD

Monitor-only symbols may be scored and displayed as READY for research, but they are not eligible for `selectedForSubmission` or broker order submission.

Current source of truth: `docs/PAPER_DAILY_CRYPTO_DAY.md`.

No real-money execution is authorized.
