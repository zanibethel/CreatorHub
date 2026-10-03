# Paper watchlist review — data through October 2, 2026

The selected universe is for monitoring and paper research. No entry strategy was backtested, no expected return is estimated, and this review does not route orders.

## Saved model

The $1,000 challenge assigns $200/$400/$400 to day/multi-day/multi-week pools. The 9% per-position cap means $18/$36/$36 of position value; it does not specify loss risk. Crypto uses those same pools. The inverse sleeve remains at zero allocation. The actual Alpaca paper balance is displayed separately and is not silently substituted for this challenge budget. Entry, stop, daily-loss and aggregate correlated-exposure rules are still needed before automation.

## Selected list

- **SPY — Core benchmark.** Lowest measured volatility among the selected broad equity candidates; use as the market baseline.
- **QQQ — Growth benchmark.** Liquid growth exposure; its 0.93 correlation with SPY means these are overlapping equity risks.
- **IWM — Small-cap comparison.** Adds a small-cap comparison with lower measured drawdown than the higher-volatility tech candidates.
- **XLV — Sector comparison.** Lower measured volatility and 0.22 correlation with SPY in the reviewed year.
- **AAPL — Individual-stock candidate.** Liquid fractional stock with a smaller measured one-year drawdown than MSFT, AMZN, GOOGL and META.
- **JPM — Financial-sector candidate.** Adds financial-sector coverage with lower measured volatility than the selected tech stock.
- **XOM — Energy-sector candidate.** Adds energy coverage; negative correlation with SPY in this sample is descriptive, not a guaranteed hedge.
- **GLD — Diversifier research.** Adds gold-price exposure, but its 26% drawdown rules out treating it as a low-risk cash substitute.
- **NVDA — Higher-volatility research.** Liquid active-trading research candidate; higher volatility means tighter risk review, not a larger position.
- **SH — Inverse monitor only.** Daily -1x S&P 500 objective; inverse allocation is still zero and multi-day results can diverge from -1x.
- **BTC-USD — Crypto research.** Crypto reference; reviewed drawdown exceeds 50%. Fees and execution costs must pass testing before entry.
- **ETH-USD — Crypto research.** Second crypto reference; reviewed drawdown exceeds 65%. Keep the same pool/position caps and test costs first.

The first equities to develop entry/risk tests around are SPY, IWM and XLV; QQQ is the growth comparator. AAPL/JPM/XOM are the individual-stock comparisons. GLD/NVDA require additional volatility review. BTC/ETH stay research candidates pending fee-aware execution tests. SH has no assigned budget. Pool labels express research suitability, not permission to buy.

## Historical comparison

| Symbol | 1-year adjusted-close change | Annualized daily volatility | 1-year maximum close drawdown | 20-session dollar-volume proxy | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| GLD | 7.1% | 29.6% | -26.4% | 3.46B USD | Selected |
| JPM | 10.1% | 22.5% | -15.5% | 2.90B USD | Selected |
| MSFT | 1.2% | 32.8% | -34.5% | 10.72B USD | Reserve |
| PSQ | -17.3% | 20.0% | -25.0% | 0.39B USD | Reserve |
| IWM | 16.5% | 18.7% | -11.0% | 6.91B USD | Selected |
| NVDA | 24.2% | 37.7% | -20.2% | 24.95B USD | Selected |
| SPY | 16.3% | 13.0% | -8.9% | 35.28B USD | Selected |
| XOM | 51.6% | 26.0% | -20.1% | 2.30B USD | Selected |
| SH | -9.4% | 13.0% | -17.5% | 0.31B USD | Selected |
| AAPL | 30.3% | 24.7% | -13.8% | 14.04B USD | Selected |
| AMZN | 13.1% | 34.4% | -21.7% | 8.86B USD | Reserve |
| DIA | 11.5% | 12.7% | -9.8% | 1.78B USD | Reserve |
| GOOGL | 40.2% | 31.8% | -21.0% | 9.44B USD | Reserve |
| META | 0.5% | 41.9% | -29.9% | 16.66B USD | Reserve |
| QQQ | 24.3% | 20.0% | -12.0% | 24.78B USD | Selected |
| XLV | 18.0% | 15.7% | -10.5% | 1.36B USD | Selected |
| BTC-USD | -29.9% | 44.9% | -53.1% | Venue only | Selected |
| ETH-USD | -40.6% | 63.6% | -66.6% | Venue only | Selected |
| SOL-USD | -49.5% | 67.1% | -73.5% | Venue only | Reserve |

DIA largely duplicates broad-equity coverage. MSFT/AMZN/GOOGL/META remain reserves to keep growth/tech coverage manageable; MSFT and META also had deeper drawdowns than AAPL. PSQ duplicates the inverse role. SOL remains a reserve after a 73.5% drawdown. Those are scope decisions, not predictions of relative performance. Historical winners were not automatically selected.

QQQ/SPY correlation was 0.93. XLV/SPY was 0.22; GLD/SPY 0.33; XOM/SPY -0.28. All are one-year daily stock-return sample correlations and may change. Cash remains possible when no validated setup exists; this list does not imply holding every symbol.

## Data and reproducibility

Retrieved from the connected Alpaca market-data API on October 3, 2026. Each equity has 503 daily bars over October 1, 2024–October 2, 2026, SIP feed, adjustment=all. Each crypto pair has 732 complete UTC daily bars; the incomplete October 3 bar is removed. Both responses had no next-page token. Asset catalog checks found all 12 selections active, tradable and fractionable; these flags do not establish account-specific order eligibility.

Run `python research/paper-watchlist/analyze.py` to regenerate `metrics-2026-10-02.json` from `history-2026-10-02.csv`. Returns use the last available close at or before calendar 30/90/365-day cutoffs. Annualized sample daily-return volatility uses 252 equity sessions / 365 crypto days. Maximum drawdown uses closes over the last year. ATR is a simple 14-session mean true range divided by latest close. Dollar volume is a 20-session mean of close times volume, a liquidity proxy rather than an executable spread. Crypto venue volumes are not comparable to consolidated stock liquidity.

Corporate-action-adjusted close change is not a fee/slippage-aware strategy return. No execution simulation, regime robustness, out-of-sample strategy validation or profitable day-trading inference is made. Daily bars cannot establish intraday behavior. The report's IEX quotes and Kraken crypto quotes differ from the research feeds.

SH targets daily -1x S&P 500 results; longer holdings can diverge because of compounding. [Issuer description](https://www.proshares.com/our-etfs/leveraged-and-inverse/sh). Crypto has execution fees; use the [current Alpaca fee schedule](https://docs.alpaca.markets/us/docs/crypto-fees) in future tests. [Fractional trading](https://docs.alpaca.markets/us/docs/fractional-trading) supports small notionals but order type, minimum size and account eligibility must be checked at execution.

## Report behavior

The central Supabase watchlist is service-role controlled. A public read-only API projects validated symbols, roles and metrics. Public visitors cannot overwrite it. All five report screens show the same symbol strip; market monitoring derives its symbols from that configuration. Old browser-local symbol overrides are ignored. QR/display preferences remain browser-local. The published selection provides a last-known fallback if central reads fail, with an explicit status message. The dated historical review remains a snapshot of this selection version.
