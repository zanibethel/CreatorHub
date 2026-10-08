# Market Mover Intelligence — v2 observational quality gates

Status: **v2 signal-quality hardening**, release pending verification. This is one research module under the Historical Pattern Intelligence Engine. Live trading remains disabled and **this module cannot authorize simulated trades either**.

## Hypothesis
Large market participants may leave reproducible activity patterns before some 4–20% moves over intraday, 1–3-day, and two-week horizons. Test this claim against **matched non-winners**. Do not treat correlation with momentum, price, or volume as proof that a particular institution bought.

## Live v1: research-only, existing data budget
- Each 15 minutes, a CRON_SECRET-protected job at `/api/paper-trading/market-movers/scan` reads recently seen, high-scoring prospects from the current scanner.
- Up to 8 crypto candidates: Alpaca `crypto/us/latest/orderbooks`. Save the **top ten displayed bid/ask levels within 2% of midprice**, directional depth imbalance, spread, and source timestamp. A displayed order can be canceled without execution; it is **not a purchase**.
- Up to 8 stocks during regular ET hours: Alpaca `stocks/{symbol}/trades` using **IEX-only** prints in the prior 20 minutes, limited to 1,000 records. Save exceptional print notional relative to the sampled median, not buyer identity nor buy/sell aggressor.
- New `public.paper_market_mover_observations` stores additive timestamped signals with source, scope, actor class `unattributed`, score (0–65 provisional ceiling), confidence, market-data event time, actual first availability/observation time and metrics.
- The table has RLS enabled, no `anon` or `authenticated` grants/policies, and service-role-only writes/reads.
- View `/paper-trading/movers`; fetch public, read-only observations from `/api/paper-trading/market-movers`. No secret credentials reach the browser.
- Source failures yield partial results/errors and do not create synthetic evidence. Idempotent 15-minute buckets reduce accidental duplicate samples.
- **No changes** to the existing scanner Prospect Score, bot readiness, bot trade conditions, per-bot ledgers, orders, risk, execution, or Pine simulation logic.

## Midas v2 quality control (crypto depth)

The original BAT/USD snapshot displayed about $7 on one side of the book yet received a 65/100 strength score. It remained extreme across scans and did not represent verified accumulation. The v2 safeguards prevent such snapshots from receiving an eligible score.

- Continue collecting timestamped **rejected** and **watching** observations as evidence with `quality_status`, `quality_version`, `quality_reason`, and raw unverified imbalance.
- Both near-midpoint displayed sides must be **at least $20,000 each**, with **$100,000 combined** within 2% of midprice; spread must be **<=0.50%**. These are provisional research floor settings, not empirically optimized signal thresholds.
- Both sides must have **at least two eligible price levels**, and no single displayed level may hold >90% of a side's depth. A direction needs **>=15% signed imbalance**.
- Before a positive score, a **separate persisted v2 quality-gated observation** from 10–45 minutes earlier must independently show the same direction. Confirmations are per-symbol and per-direction with strict first-observable-time fencing. Current 15-minute scans permit two-point confirmation. A repeated thin book is still rejected.
- The public API shows legacy ungated crypto scores as zero eligible score, retains the old raw value in the evidence, and labels the sample **legacy**. This does not rewrite any existing Supabase event record.
- `score` is zero until `quality_status=confirmed`; this confirms **consistent displayed depth**, not an actual whale purchase, actor identity, or model forecasting accuracy. Confidence remains a low-evidence research label and is not a calibrated probability. The scanner and all simulated bot execution gates are unchanged.
- If history cannot be read, crypto signal evaluation fails closed instead of silently assuming confirmation.
- Thresholds and venue coverage must be validated against long-run false-positive and missed-move results before they are tuned or influence bot decision making.

## Score interpretation
This is a directional **research strength** signal, **not** win probability. Displayed depth and isolated trade prints are low-confidence proxies. A strong displayed bid imbalance can mean short-lived liquidity, not verified accumulation. Stock print direction is always `unknown` in v1. Research scores from buy-side and sell-side snapshots must never be pooled as if both predict upside.

## Next independent evidence sources
1. **Insider Form 4**: parse transaction code, direct/indirect, price, quantity, insider identity/role, transaction date, **SEC accepted/published timestamp**. Distinguish open-market `P` buys from awards or exercises. No alert before disclosure.
2. **Institutional 13F**: filing manager CIK, report as-of quarter-end, report publication timestamp, amendment chain, adjusted CUSIP-to-ticker map, and positions/changes between reports. Never pretend the filing specifies an intraday buy date. Short exposures are not fully visible.
3. **Public-chain whales**: wallet-address clusters, token transfers, DEX swaps, exchange deposit/withdrawal labels with independently verified provenance. Transfers do not equal trades, and wallets do not automatically identify a person or company.
4. **Off-exchange and derivatives**: eligible FINRA aggregate volume and unusual options activity where legal API/data licensing permits. Distinguish delayed aggregate data from real-time prints.

Each source needs its own immutable event ID, detection/availability timestamps, source version, deduplication, provenance and actor-identity confidence before weighting. No fabricated actor names.

## Historical Pattern Intelligence Engine: validation contract
- For **every** historical window of 4–20% gains (intraday / 1–3 days / up to two weeks), calculate 24-hour pre-move footprint and 3-/6-/12-month context. Also select matched controls for asset, liquidity, volatility, time and market regime that **did not** reach the gain target.
- A training example's feature cutoff is the **first time information was available to our system**, `available_at`, never the trade's backdated `event_at` nor a later SEC filing's reported period. Freeze feature snapshots.
- Use purged, walk-forward, chronological train/validation/test windows (and embargo for overlapping labels), with no future ticker survivorship filtering.
- Track precision, recall, false-positive rate, time-to-move, lift over existing scanner, slippage/fees-adjusted simulated expectancy, MAE/MFE, and drawdowns **per horizon and source**. Include rejected signals and losses.
- Only propose a **capped and separately named** Market Mover contribution to the existing scanner after out-of-sample lift is demonstrated and approved. Never bypass liquidity, stops, strategy, exposure or execution guards.
- Measure cost and source coverage; feature-gate paid providers and prevent uncontrolled external API usage.

## Operational checklist
- [x] Evidence-only scoring code, test fixtures and append-only DB migration committed on a feature branch
- [x] Private Supabase table created and RLS enabled
- [x] Cron sampler, read-only API, dashboard and 15-minute schedule implemented on branch
- [x] Original v1 merged and production read endpoint verified; real crypto book observations persisted
- [ ] v2 quality-hardening PR reviewed, CI verified and merged
- [ ] v2 production deployment healthy and next two separate scheduled collection cycles verified with gated evidence
- [ ] Verified Form 4 ingestion; historical institutional quarterly ingestion
- [ ] Verified on-chain wallet clustering; historical control-group research
- [ ] Out-of-sample calibration; **only then** discuss scanner score influence

## References
- [Product architecture](./AUTOMATED_SIGNAL_PRODUCT_PLAN.md)
- [Prospect scanner](./PAPER_PROSPECT_SCANNER.md)
- [Bot roster](./BOT_ROSTER.md)
- [SEC public company submissions](https://www.sec.gov/edgar/sec-api-documentation)
- [Alpaca orderbooks](https://docs.alpaca.markets/docs/crypto-trading)
