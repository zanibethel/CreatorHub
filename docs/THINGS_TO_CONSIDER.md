# Things to Consider — CreatorHub

Living backlog of external findings, possible upgrades, trading-research observations, and solution ideas that may improve CreatorHub.

These are **not approved implementation tasks**. Re-validate every item against current code, current data, and current market/provider conditions before implementation. New market/news signals may inform research but must not directly bypass trading risk gates.

Last reviewed: 2026-10-27

## Status key

- **Consider** — useful signal; needs research.
- **Evaluate** — worth testing/backtesting.
- **Recommend** — evidence supports implementation; still requires approval.
- **Approved** — user explicitly approved implementation.
- **Implemented** — landed and verified.
- **Rejected / Superseded** — intentionally not pursuing.

---

## 1. Add verified news/catalyst context to trading research

**Status:** Implemented foundation / ingestion still unverified  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-27

### Finding
Daily market/news intelligence can explain why a symbol or asset class is moving and can help distinguish broad-regime moves from symbol-specific catalysts.

### Why it may matter
The current scanners are primarily market-data-driven. Useful context could include:
- company/asset catalyst;
- sector catalyst;
- macro regime;
- source;
- timestamp;
- confidence;
- whether the catalyst is confirmed by a primary/reputable source.

### Possible solution
Persist news/catalyst context as **research metadata first**, not as automatic score points.

Suggested shape:
- `catalyst_type`
- `catalyst_summary`
- `source_url`
- `source_tier`
- `observed_at`
- `confidence`
- `macro_regime`
- `symbols`

### Recommended implementation
Run this in shadow mode and later compare outcomes:
- candidates with/without catalysts;
- catalyst categories;
- false positives;
- continuation/reversal rates;
- effect on simulated expectancy.

Only promote news into scanner scoring if historical evidence shows a measurable improvement.

### 2026-10-07 evidence update
The capped news-scoring fields and v3 catalyst/acceleration discovery path have landed. The dedicated `paper_news_signals` table is still empty, however, and the current sampled prospects all had zero persisted news evidence/impact.

OPCH is the first useful audit case. The official $32.05-per-share acquisition announcement explains the roughly 33% move, but the recorded scanner observations began after the gap was already established. This validates the scanner's ability to retain an active mover, not an early-catalyst edge.

Before changing any score weight, verify the ingest job end to end and compare each signal's publication time, first observed time, first scanner time, first review-ready time, and remaining price opportunity.

### 2026-10-23 evidence update
The dedicated `paper_news_signals` table still has zero rows despite active prospect scans. The October 22 T handoff is a retrospective catalyst-timing test because Reuters reported new telecom competition concerns October 23. First determine whether ingestion is running and whether news can be attached without look-ahead bias.

### Recommendation
Do **not** let a newsletter mention create an entry signal or override spread/liquidity/risk gates.

---

**2026-10-27 evidence:** `paper_news_signals` remains empty despite six current review-eligible stock prospects. SOFI and JBLU have independently confirmed earnings catalysts; compare company publication timestamps with first scanner eligibility and bot handoff. Persist research context only; do not assign a news score or authorize orders from this report. Sources: https://investors.sofi.com/news/news-details/2026/SoFi-Reports-Third-Quarter-2026-with-Record-Net-Revenue-of-1-4-Billion-Net-Income-of-241-Million-and-Raises-Full-Year-Guidance/default.aspx ; https://investor.jetblue.com/news/news-details/2026/JetBlue-Announces-Third-Quarter-2026-Results/default.aspx .

## 2. Prospect Scanner five-minute cadence

**Status:** Implemented  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-06

### Finding
The canonical v3 config now contains `cadenceMinutes: 5`, and the scheduled Swing intake/execution runner also runs every five minutes on weekdays.

### Why it may matter
The five-minute interval gives more granular evidence for developing moves while increasing API calls, duplicate samples, and storage.

### Possible solution
Continue monitoring provider/API load, storage growth, idempotency, and actual persisted run spacing. Treat configuration and runtime cadence as one operational control.

### Recommendation
Keep the five-minute cadence while observed load remains acceptable; alert on drift between configured and persisted cadence.

### 2026-10-07 evidence update
The canonical scanner is `paper-prospect-scanner-v3` at five minutes. Persisted observations reviewed today show five-minute spacing, so the prior 10-minute discrepancy is resolved.

---

## 3. 2026-10-05 prepared swing candidates received market confirmation but still require revalidation

**Status:** Superseded / counterfactual follow-up  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-06

### Finding
The prepared swing candidates QQQ, NVDA, and MSFT traded into/near their previously staged entry regions during a strong technology/Nasdaq session. They are now historical plans; the live product path uses scanner-v3 review-ready prospects and a separately gated Swing intake.

Current research snapshot near the close:
- QQQ about $755.92; prepared trigger about $755.26.
- NVDA about $238.90; prepared trigger about $238.07.
- MSFT about $526.27; prepared trigger about $522.98.

### Why it may matter
This supports the original continuation/breakout thesis but does not replace the strategy's required revalidation.

### Recommendation
Treat this as evidence for the journal/counterfactual system. Do not hard-code or permanently boost these symbols because of one session.

### 2026-10-06 evidence update
At about 8:56 a.m. Central, external market data showed:
- QQQ about $760.81, slightly above the prior $760.11 maximum entry;
- NVDA about $242.40, above the prior $240.63 maximum entry;
- MSFT about $532.04, above the prior $528.82 maximum entry.

The prior entry windows should therefore be treated as stale pending the strategy's own persisted revalidation. Do not chase or rewrite the historical plan. Preserve the original proposal and measure the subsequent counterfactual outcome.

Market context: the S&P 500 briefly reached an intraday record while the Nasdaq traded at record highs as yields and oil eased.

### 2026-10-07 evidence update
The persisted counterfactual record now classifies QQQ and NVDA as expired/never-triggered. MSFT triggered but remained unresolved in the reviewed record, with about +0.203R maximum favorable excursion and -0.108R maximum adverse excursion. Preserve these exact historical plans while measuring the new dynamic handoff separately.

Reference: https://www.reuters.com/business/wall-st-futures-rise-yields-oil-dip-2026-10-06/

---

## 4. Crypto volume expansion without clean bot-review qualification

**Status:** Monitor / more counterfactual evidence  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-27

### Finding
Research snapshot:
- ETH showed unusually high relative volume while price remained slightly negative.
- ADA and RENDER showed positive price action plus elevated relative volume.
- BTC and SOL did not produce a clean qualifying setup.
- None of these reached the bot-review threshold in the current scanner state.

### Why it may matter
High relative volume without directional confirmation is useful evidence for future scoring research but is not enough by itself for an entry.

### Possible solution
Track subsequent 1h/4h/24h outcomes for combinations of:
- relative-volume band;
- price direction;
- distance from session high;
- spread;
- broader BTC regime.

### 2026-10-06 evidence update
Bitcoin was rejected near $87,000 for the third time since September 23 and remained near $86,000, while ETH and SOL were modestly negative in the reviewed snapshot. ADA showed a stronger multi-session move but was also off its intraday high. This increases breakout/reversal uncertainty rather than supplying a new entry authorization.

### 2026-10-07 evidence update
Bitcoin fell to roughly $83.4K, ETH to roughly 
**Status:** Monitor / more counterfactual evidence  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-26

### Finding
Research snapshot:
- ETH showed unusually high relative volume while price remained slightly negative.
- ADA and RENDER showed positive price action plus elevated relative volume.
- BTC and SOL did not produce a clean qualifying setup.
- None of these reached the bot-review threshold in the current scanner state.

### Why it may matter
High relative volume without directional confirmation is useful evidence for future scoring research but is not enough by itself for an entry.

### Possible solution
Track subsequent 1h/4h/24h outcomes for combinations of:
- relative-volume band;
- price direction;
- distance from session high;
- spread;
- broader BTC regime.

### 2026-10-06 evidence update
Bitcoin was rejected near $87,000 for the third time since September 23 and remained near $86,000, while ETH and SOL were modestly negative in the reviewed snapshot. ADA showed a stronger multi-session move but was also off its intraday high. This increases breakout/reversal uncertainty rather than supplying a new entry authorization.

### 2026-10-07 evidence update
Bitcoin fell to roughly $83.4K, ETH to roughly $2.56K, and SOL to roughly $116 in the reviewed morning snapshot. Five same-day rejected/waiting crypto setups completed as counterfactuals: BTC, ETH, and SOL stopped before 1R; DOT and LINK reached at least 1R before later stopping. No new paper order was created.

### 2026-10-23 evidence update
329 mixed-version counterfactuals: 120 stopped before 1R, 42 stopped after 1R, and 67 reached 2R before stop. Spark rejected LINK/USD for spread/momentum and its stale one-position ledger; Flash rejected SOL/USD on trend/BTC regime. These are research outcomes, not executed profitability.

### 2026-10-24 evidence update
352 mixed-version counterfactual records now include 128 stopped before 1R, 47 stopped after 1R, and 69 reached 2R before stop; 108 have other/pending/ambiguous outcomes. Spark still rejects new SOL research partly because its stale BTC position occupies its one-position limit. Preserve fee- and regime-adjusted research separation.

### Recommendation
Collect fee-adjusted, per-version evidence before changing weights. Retain quote, spread, trend, breakout, fee-coverage, score, and BTC-regime gates.

Reference: https://www.coindesk.com/markets/2026/10/06/bitcoin-keeps-getting-rejected-at-usd87-000-as-stocks-hover-near-records

---

**2026-10-25 evidence:** 362 counterfactuals: 141 stopped before 1R, 49 after 1R, 69 reached 2R before stopping, and 103 other/pending/ambiguous outcomes. Weekend Flash rejected LINK/USD (score 10) on spread, completed-bar, trend and opportunity gates; Spark rejected BTC/USD (score 65) partly because the unreconciled BTC position still occupies its one-position limit. These are hypothetical/research outcomes, not fills. Segment by strategy version, costs, and regime before changing weights.

**2026-10-26 evidence:** 372 mixed-version counterfactual records: 149 stopped before 1R, 49 after 1R, 70 reached 2R before stop, and 104 other/pending/ambiguous. Spark rejected DOT/USD with its one-position limit occupied by unreconciled BTC exposure; Flash rejected DOT/USD on spread, insufficient bars, BTC regime, and weak momentum. Evaluate fee-adjusted outcomes by strategy/version; do not change weights.

.56K, and SOL to roughly ## 4. Crypto volume expansion without clean bot-review qualification
16 in the reviewed morning snapshot. Five same-day rejected/waiting crypto setups completed as counterfactuals: BTC, ETH, and SOL stopped before 1R; DOT and LINK reached at least 1R before later stopping. No new paper order was created.

### 2026-10-23 evidence update
329 mixed-version counterfactuals: 120 stopped before 1R, 42 stopped after 1R, and 67 reached 2R before stop. Spark rejected LINK/USD for spread/momentum and its stale one-position ledger; Flash rejected SOL/USD on trend/BTC regime. These are research outcomes, not executed profitability.

### 2026-10-24 evidence update
352 mixed-version counterfactual records now include 128 stopped before 1R, 47 stopped after 1R, and 69 reached 2R before stop; 108 have other/pending/ambiguous outcomes. Spark still rejects new SOL research partly because its stale BTC position occupies its one-position limit. Preserve fee- and regime-adjusted research separation.

### Recommendation
Collect fee-adjusted, per-version evidence before changing weights. Retain quote, spread, trend, breakout, fee-coverage, score, and BTC-regime gates.

Reference: https://www.coindesk.com/markets/2026/10/06/bitcoin-keeps-getting-rejected-at-usd87-000-as-stocks-hover-near-records

---

**2026-10-25 evidence:** 362 counterfactuals: 141 stopped before 1R, 49 after 1R, 69 reached 2R before stopping, and 103 other/pending/ambiguous outcomes. Weekend Flash rejected LINK/USD (score 10) on spread, completed-bar, trend and opportunity gates; Spark rejected BTC/USD (score 65) partly because the unreconciled BTC position still occupies its one-position limit. These are hypothetical/research outcomes, not fills. Segment by strategy version, costs, and regime before changing weights.

**2026-10-26 evidence:** 372 mixed-version counterfactual records: 149 stopped before 1R, 49 after 1R, 70 reached 2R before stop, and 104 other/pending/ambiguous. Spark rejected DOT/USD with its one-position limit occupied by unreconciled BTC exposure; Flash rejected DOT/USD on spread, insufficient bars, BTC regime, and weak momentum. Evaluate fee-adjusted outcomes by strategy/version; do not change weights.

**2026-10-27 evidence:** 411 counterfactuals: 168 stop-before-1R, 53 stop-after-1R, 81 reached 2R before stop, 109 other/pending/ambiguous. Spark still rejects BTC/USD with an occupied-position blocker. Retain per-version, fee/spread- and market-regime-adjusted research; no execution threshold changes.

## 5. Squeeze liquidity gates appear to be protecting against headline-chasing

**Status:** Evaluate historical scanner-to-bot handoff  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-27

### Finding
BSBR was the strongest current squeeze candidate in the reviewed snapshot but remained below the watchlist threshold. FNGR showed a notable positive session move while the scanner still rejected it because the observed setup/liquidity quality was poor, including a very wide quoted spread in the snapshot.

### Why it may matter
This is the behavior we want: price movement alone should not qualify a squeeze trade.

### 2026-10-06 evidence update
At about 8:57 a.m. Central, FNGR was about $0.2467 and down roughly 8.6% after the prior session's positive move. BSBR was about $5.80 and up only about 0.35%. This is consistent with the scanner refusing to promote a flashy but poor-liquidity move and supports retaining the existing gates.

### 2026-10-07 evidence update
OPCH was retained by the squeeze scanner as a watchlist item but was not bot-review eligible. Its acquisition-driven gap is not evidence to weaken squeeze gates: it was already roughly 33% higher when first retained. Very wide-spread, low-dollar-volume names in the same snapshot remained ineligible.

### 2026-10-23 evidence update
EYPT was review-eligible October 19 during an approximately 80% drop with a 13.28% quoted spread, then became ineligible. October 22 T, SSPC, and SOXS were eligible; October 23 has none. Check first-eligible quote snapshots and downstream decisions; a transient eligible state is not a completed risk-gate bypass.

### Recommendation
Preserve spread/liquidity gates. Audit historical scanner-to-bot handoffs and later outcomes before proposing changes.

---

**2026-10-25 evidence:** Sunday Atlas labeled DIA `qualified` (score 84) while explicitly blocking execution on quote freshness, spread, bearish regime, score below the 85 trade-ready threshold, and allocation checks. No broker order followed. Keep research qualification distinct from executable readiness and verify UI/analytics never collapse those states.

**2026-10-27 evidence:** Six stock prospects are bot-review eligible at ~14:00 UTC: SOFI 95 (+11.03%), TSLL 92 (+5.53%), JBLU 83 (+14.56%), SNXX 83, IREN 83, USAR 83. SOFI's earnings release and JBLU's Oct 26 earnings release provide primary-source catalysts; Pulse independently marks SOFI `watch` because acceleration/5-minute confirmation are insufficient. TSLL is a daily-reset 2x Tesla ETF, requiring a distinct instrument-risk audit, not automatic treatment as ordinary stock momentum. No new broker order was verified. Source: https://www.direxion.com/product/daily-tsla-bull-and-bear-leveraged-single-stock-etfs .

## 6. Daily intelligence should feed research, not silently rewrite the algorithm

**Status:** Implemented guardrail / ongoing validation  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-07

### Possible solution
For market/news findings:
1. verify the claim;
2. attach it to relevant symbols/regimes as research metadata;
3. record the algorithm version and candidate state at the time;
4. measure subsequent outcomes;
5. propose an algorithm change with evidence;
6. require explicit approval before changing scoring/risk/execution logic.

### 2026-10-07 evidence update
CreatorHub now preserves scanner, strategy, risk, and execution versions with immutable historical decisions and separately stored later analysis. News impact is capped and cannot authorize an order. This implements the governance pattern; outcome quality still needs longitudinal validation.

### Recommendation
Keep scanner/risk changes versioned and evidence-based. Live execution remains out of scope unless separately and explicitly approved.

---

## 7. EmbeddingGemma 2 for private multimodal asset retrieval

**Status:** Evaluate / do not block Upload Center MVP  
**Added:** 2026-10-07  
**Last reviewed:** 2026-10-07  
**Source:** Google Developers Blog / official model documentation

### Finding
Google released EmbeddingGemma 2, a 740M open-weight multimodal embedding model for text, images, video, and audio. Google reports modular on-device memory use of roughly 191 MB for text-only and 567 MB for the full model on a Pixel 11 Pro, with MediaPipe Tasks and LiteRT paths for mobile acceleration.

### Why it may matter
CreatorHub's new Upload Center can eventually support private semantic search, related-asset discovery, duplicate detection, and retrieval of editing context without sending every asset to a hosted embedding provider.

### Possible solution
Run a small shadow benchmark over representative uploaded text, thumbnails, short audio, and video keyframes. Compare retrieval quality, indexing time, memory, battery/CPU use, index size, and privacy boundaries against hosted embeddings.

### Recommendation
Do not add embedding or indexing to the initial upload/download MVP. First define index ownership, deletion behavior, encryption, device/cloud placement, and rebuild semantics; then prototype behind an explicit opt-in flag.

Reference: https://developers.googleblog.com/en/introducing-embeddinggemma-2/

---

## 8. Broker protection, event delivery, and virtual-ledger reconciliation

**Status:** Urgent fix recommended — approval required  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-27

**Evidence:** Alpaca PAPER holds 2 CCC shares at $7.65 average with no open broker orders; the database retains an intended $7.162513 stop. Four broker fills are unapplied: Spark BTC exit (Oct 12) and Pulse CIFR buy plus two sells (Oct 13). Broker stream heartbeat is Oct 12 17:55:58 UTC, although scheduled jobs continue returning HTTP 200. Spark's stale BTC ledger also blocks its one-position strategy.

**2026-10-24 evidence:** Alpaca PAPER still holds 2 CCC shares at $7.65 with **zero open broker orders**; Oct 23 close was $7.67. The four unapplied Spark/Pulse fills and Oct 12 17:55 UTC stream heartbeat persist. A newly reconciled *existing* Oct 15 primary-source catalyst: CCC Intelligent Solutions agreed to a $7.75/share cash acquisition by GTCR/Elliott, expected Q1 2027 subject to approvals. This changes the risk context of the unprotected position; a pending merger is not an executed exit or an active stop. Distinguish NASDAQ:CCC from Crown Castle NYSE:CCI. Source: https://www.cccis.com/news-and-insights/posts/ccc-intelligent-solutions-signs-definitive-agreement-to-be-acquired-by-gtcr-and-elliott

**Possible solution:** Independently check protective-order coverage, broker stream delivery, and fill-to-ledger parity; replay fills idempotently by activity ID and test duplicate, partial, expired-DAY, and missed-event cases.

**2026-10-25 evidence:** Alpaca PAPER still holds 2 CCC shares at $7.65 average and **zero open orders**; last Friday's mark is $7.67. Four unapplied fills remain (Spark BTC exit and Pulse CIFR buy/two sells). Broker stream heartbeat is still Oct 12 17:55:58 UTC (`stale_heartbeat`, ~12.8 days old); Spark's stale position continues blocking research. Sunday crypto schedulers respond HTTP 200 but that does not prove event delivery. No broker order was modified.

**Recommendation:** Prioritize a read-only reconciliation and isolated regression tests. Any broker-order action or production execution modification needs separate explicit approval. Keep PAPER only.

**2026-10-26 evidence:** Alpaca PAPER still holds 2 CCC shares at $7.65 average; the broker reports **zero open orders** and $7.6602 current valuation. Four Oct 12–13 fills remain unapplied (Spark BTC sell, Pulse CIFR buy/two sells); broker-stream heartbeat remains Oct 12 17:55:58 UTC with `stale_heartbeat` (~13.8 days). Spark's stale position continues to block research. **Recommendation unchanged:** urgent read-only reconciliation and isolated idempotency/protection tests; broker-order changes require separate approval.

**2026-10-27 evidence:** Alpaca PAPER still holds 2 CCC at $7.65 average, latest mark ~$7.695, **zero open orders**; the database's ~$7.1625 stop is not active. Four unapplied fills remain (Spark BTC exit; Pulse CIFR buy/two sells). Broker stream heartbeat remains 2026-10-12 17:55:58 UTC (~14.8 days stale), despite healthy scheduler HTTP responses. Spark's stale BTC ledger still blocks its one-position strategy. **Status/recommendation unchanged: urgent**, read-only reconciliation and isolated idempotent fill/protection tests; broker-order or execution changes need separate approval.

## 9. Shared $5,000 challenge execution acceptance

**Status:** Shadow implemented / acceptance pending  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-27

**Evidence:** `shared-paper-v1` remains preview, broker execution disabled; 55,046 projected source observations, zero challenge-specific strategy revalidations, proposal records, or authorized broker orders.

**Possible solution:** Prove challenge-scoped capital isolation, owner access, immutable proposal lineage, strategy revalidation, and broker reconciliation in isolated tests.

**2026-10-25 evidence:** `shared-paper-v1` preview has 58,118 projected source observations (+3,072 since Oct 24), zero challenge proposal records or authorized orders, and broker execution remains disabled. Research volume does not establish capital-isolation or execution acceptance.

**Recommendation:** No activation or change to risk limits based on research counts.

**2026-10-26 evidence:** The `shared-paper-v1` preview contains 61,379 source observations (+3,261 since Oct 25), zero challenge proposal records, and broker execution disabled. No capital-isolation acceptance or strategy revalidation was demonstrated. Keep shadow-only.

**2026-10-27 evidence:** Shared-paper-v1 preview now has 65,939 source observations (+4,560 since Oct 26); zero proposal journal records or authorized broker orders, broker execution disabled. No demonstrated capital-isolation/strategy-revalidation acceptance. Continue shadow only.

## 10. Market-regime and leveraged-instrument event studies

**Status:** Evaluate / historical handoff audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-27

**Evidence:** Reuters Oct 23 reports renewed AI-sector selling, higher oil, and telecom competition concerns. T and leveraged inverse SOXS were among October 22 review-eligible prospects; both are ineligible on October 23. Solana's Alpenglow activation was confirmed October 21.

**2026-10-24 evidence:** Oct 23 U.S. close: S&P 500 -0.52%, Nasdaq -0.21%, Dow -1.23%, Brent ## 10. Market-regime and leveraged-instrument event studies
16.72 (AP). Weekend Alpaca crypto latest trades near BTC $80,630, ETH 
**Status:** Evaluate / historical handoff audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-26

**Evidence:** Reuters Oct 23 reports renewed AI-sector selling, higher oil, and telecom competition concerns. T and leveraged inverse SOXS were among October 22 review-eligible prospects; both are ineligible on October 23. Solana's Alpenglow activation was confirmed October 21.

**2026-10-24 evidence:** Oct 23 U.S. close: S&P 500 -0.52%, Nasdaq -0.21%, Dow -1.23%, Brent $116.72 (AP). Weekend Alpaca crypto latest trades near BTC $80,630, ETH $2,364, SOL $101.40, LINK $11.60, DOT $1.07; timestamps differ. Newly identified CCC $7.75 merger agreement is a corporate-action research case for Harbor, **not** Crown Castle/SpaceX (CCI) news. Treat prices as snapshots, not signals. Ethereum Foundation confirmed Oct 22 that Glamsterdam's Oct 26 Hoodi *testnet* activation was postponed over EIP-8037 interactions; this is not a mainnet incident or an ETH trade signal. Source: https://blog.ethereum.org/2026/10/22/glamsterdam-hoodi-delay . Sources: https://apnews.com/article/7b47ef3b037bfba4e34f685329b9b963 ; https://www.cccis.com/news-and-insights/posts/ccc-intelligent-solutions-signs-definitive-agreement-to-be-acquired-by-gtcr-and-elliott

**Possible solution:** Run event studies for T's telecom catalyst, inverse semiconductor ETF behavior, and SOL after Alpenglow. Segment outcomes by market regime, instrument structure, strategy version, liquidity, and fees; use the existing scanner handoff and verified-news entries for gating and provenance.

**2026-10-25 evidence:** CoinDesk reported BTC briefly below $80,000 on Oct 24 amid renewed Middle East risks; Alpaca Oct 25 14:02 UTC BTC last trade was ~$80,254 (not a simultaneous executable quote). Reuters Oct 23 confirmed Brent at $116.72 and technology-sector financing concerns. Use weekend BTC/SOL/ETH risk-off conditions and Friday equity closes for timestamped regime studies only. Source: https://www.coindesk.com/markets/2026/10/24/crypto-under-weekend-pressure-bitcoin-slides-below-usd80-000-on-u-s-middle-east-evacuations ; https://www.reuters.com/world/china/global-markets-global-markets-2026-10-23/

**Recommendation:** Preserve liquidity, BTC-regime, fee, and risk gates; never authorize orders from news or scanner score alone.

**2026-10-26 evidence:** Reuters reports U.S. futures modestly higher as oil eases ahead of the Fed decision and Alphabet/Microsoft/Amazon earnings; AI infrastructure financing remains under scrutiny. CoinDesk reports BTC near $80,000 amid cautious positioning; Alpaca's 13:23 UTC BTC trade was $79,903.80, ETH $2,315.90, SOL $101.20 (timestamps differ). Study QQQ/NVDA/MSFT and crypto regime transitions as timestamped research only. Sources: https://www.reuters.com/world/asia-pacific/global-markets-pix-2026-10-26/ ; https://www.coindesk.com/markets/2026/10/26/bitcoin-holds-near-usd80-000-as-oil-retreats-and-the-fed-decision-looms .

,364, SOL ## 10. Market-regime and leveraged-instrument event studies
01.40, LINK ## 10. Market-regime and leveraged-instrument event studies
1.60, DOT ## 10. Market-regime and leveraged-instrument event studies
.07; timestamps differ. Newly identified CCC $7.75 merger agreement is a corporate-action research case for Harbor, **not** Crown Castle/SpaceX (CCI) news. Treat prices as snapshots, not signals. Ethereum Foundation confirmed Oct 22 that Glamsterdam's Oct 26 Hoodi *testnet* activation was postponed over EIP-8037 interactions; this is not a mainnet incident or an ETH trade signal. Source: https://blog.ethereum.org/2026/10/22/glamsterdam-hoodi-delay . Sources: https://apnews.com/article/7b47ef3b037bfba4e34f685329b9b963 ; https://www.cccis.com/news-and-insights/posts/ccc-intelligent-solutions-signs-definitive-agreement-to-be-acquired-by-gtcr-and-elliott

**Possible solution:** Run event studies for T's telecom catalyst, inverse semiconductor ETF behavior, and SOL after Alpenglow. Segment outcomes by market regime, instrument structure, strategy version, liquidity, and fees; use the existing scanner handoff and verified-news entries for gating and provenance.

**2026-10-25 evidence:** CoinDesk reported BTC briefly below $80,000 on Oct 24 amid renewed Middle East risks; Alpaca Oct 25 14:02 UTC BTC last trade was ~$80,254 (not a simultaneous executable quote). Reuters Oct 23 confirmed Brent at ## 10. Market-regime and leveraged-instrument event studies
16.72 and technology-sector financing concerns. Use weekend BTC/SOL/ETH risk-off conditions and Friday equity closes for timestamped regime studies only. Source: https://www.coindesk.com/markets/2026/10/24/crypto-under-weekend-pressure-bitcoin-slides-below-usd80-000-on-u-s-middle-east-evacuations ; https://www.reuters.com/world/china/global-markets-global-markets-2026-10-23/

**Recommendation:** Preserve liquidity, BTC-regime, fee, and risk gates; never authorize orders from news or scanner score alone.

**2026-10-26 evidence:** Reuters reports U.S. futures modestly higher as oil eases ahead of the Fed decision and Alphabet/Microsoft/Amazon earnings; AI infrastructure financing remains under scrutiny. CoinDesk reports BTC near $80,000 amid cautious positioning; Alpaca's 13:23 UTC BTC trade was $79,903.80, ETH 
**Status:** Evaluate / historical handoff audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-26

**Evidence:** Reuters Oct 23 reports renewed AI-sector selling, higher oil, and telecom competition concerns. T and leveraged inverse SOXS were among October 22 review-eligible prospects; both are ineligible on October 23. Solana's Alpenglow activation was confirmed October 21.

**2026-10-24 evidence:** Oct 23 U.S. close: S&P 500 -0.52%, Nasdaq -0.21%, Dow -1.23%, Brent $116.72 (AP). Weekend Alpaca crypto latest trades near BTC $80,630, ETH $2,364, SOL $101.40, LINK $11.60, DOT $1.07; timestamps differ. Newly identified CCC $7.75 merger agreement is a corporate-action research case for Harbor, **not** Crown Castle/SpaceX (CCI) news. Treat prices as snapshots, not signals. Ethereum Foundation confirmed Oct 22 that Glamsterdam's Oct 26 Hoodi *testnet* activation was postponed over EIP-8037 interactions; this is not a mainnet incident or an ETH trade signal. Source: https://blog.ethereum.org/2026/10/22/glamsterdam-hoodi-delay . Sources: https://apnews.com/article/7b47ef3b037bfba4e34f685329b9b963 ; https://www.cccis.com/news-and-insights/posts/ccc-intelligent-solutions-signs-definitive-agreement-to-be-acquired-by-gtcr-and-elliott

**Possible solution:** Run event studies for T's telecom catalyst, inverse semiconductor ETF behavior, and SOL after Alpenglow. Segment outcomes by market regime, instrument structure, strategy version, liquidity, and fees; use the existing scanner handoff and verified-news entries for gating and provenance.

**2026-10-25 evidence:** CoinDesk reported BTC briefly below $80,000 on Oct 24 amid renewed Middle East risks; Alpaca Oct 25 14:02 UTC BTC last trade was ~$80,254 (not a simultaneous executable quote). Reuters Oct 23 confirmed Brent at $116.72 and technology-sector financing concerns. Use weekend BTC/SOL/ETH risk-off conditions and Friday equity closes for timestamped regime studies only. Source: https://www.coindesk.com/markets/2026/10/24/crypto-under-weekend-pressure-bitcoin-slides-below-usd80-000-on-u-s-middle-east-evacuations ; https://www.reuters.com/world/china/global-markets-global-markets-2026-10-23/

**Recommendation:** Preserve liquidity, BTC-regime, fee, and risk gates; never authorize orders from news or scanner score alone.

**2026-10-26 evidence:** Reuters reports U.S. futures modestly higher as oil eases ahead of the Fed decision and Alphabet/Microsoft/Amazon earnings; AI infrastructure financing remains under scrutiny. CoinDesk reports BTC near $80,000 amid cautious positioning; Alpaca's 13:23 UTC BTC trade was $79,903.80, ETH $2,315.90, SOL $101.20 (timestamps differ). Study QQQ/NVDA/MSFT and crypto regime transitions as timestamped research only. Sources: https://www.reuters.com/world/asia-pacific/global-markets-pix-2026-10-26/ ; https://www.coindesk.com/markets/2026/10/26/bitcoin-holds-near-usd80-000-as-oil-retreats-and-the-fed-decision-looms .

,315.90, SOL ## 10. Market-regime and leveraged-instrument event studies
01.20 (timestamps differ). Study QQQ/NVDA/MSFT and crypto regime transitions as timestamped research only. Sources: https://www.reuters.com/world/asia-pacific/global-markets-pix-2026-10-26/ ; https://www.coindesk.com/markets/2026/10/26/bitcoin-holds-near-usd80-000-as-oil-retreats-and-the-fed-decision-looms .

**2026-10-27 evidence:** Reuters reports Oct 26 S&P 500 +0.70%, Nasdaq +0.83% after AI-related sentiment rebounded; Oct 27 markets remain earnings-sensitive. Alpaca BTC latest trade ~$79,942, ETH ~
**Status:** Evaluate / historical handoff audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-26

**Evidence:** Reuters Oct 23 reports renewed AI-sector selling, higher oil, and telecom competition concerns. T and leveraged inverse SOXS were among October 22 review-eligible prospects; both are ineligible on October 23. Solana's Alpenglow activation was confirmed October 21.

**2026-10-24 evidence:** Oct 23 U.S. close: S&P 500 -0.52%, Nasdaq -0.21%, Dow -1.23%, Brent $116.72 (AP). Weekend Alpaca crypto latest trades near BTC $80,630, ETH $2,364, SOL $101.40, LINK $11.60, DOT $1.07; timestamps differ. Newly identified CCC $7.75 merger agreement is a corporate-action research case for Harbor, **not** Crown Castle/SpaceX (CCI) news. Treat prices as snapshots, not signals. Ethereum Foundation confirmed Oct 22 that Glamsterdam's Oct 26 Hoodi *testnet* activation was postponed over EIP-8037 interactions; this is not a mainnet incident or an ETH trade signal. Source: https://blog.ethereum.org/2026/10/22/glamsterdam-hoodi-delay . Sources: https://apnews.com/article/7b47ef3b037bfba4e34f685329b9b963 ; https://www.cccis.com/news-and-insights/posts/ccc-intelligent-solutions-signs-definitive-agreement-to-be-acquired-by-gtcr-and-elliott

**Possible solution:** Run event studies for T's telecom catalyst, inverse semiconductor ETF behavior, and SOL after Alpenglow. Segment outcomes by market regime, instrument structure, strategy version, liquidity, and fees; use the existing scanner handoff and verified-news entries for gating and provenance.

**2026-10-25 evidence:** CoinDesk reported BTC briefly below $80,000 on Oct 24 amid renewed Middle East risks; Alpaca Oct 25 14:02 UTC BTC last trade was ~$80,254 (not a simultaneous executable quote). Reuters Oct 23 confirmed Brent at $116.72 and technology-sector financing concerns. Use weekend BTC/SOL/ETH risk-off conditions and Friday equity closes for timestamped regime studies only. Source: https://www.coindesk.com/markets/2026/10/24/crypto-under-weekend-pressure-bitcoin-slides-below-usd80-000-on-u-s-middle-east-evacuations ; https://www.reuters.com/world/china/global-markets-global-markets-2026-10-23/

**Recommendation:** Preserve liquidity, BTC-regime, fee, and risk gates; never authorize orders from news or scanner score alone.

**2026-10-26 evidence:** Reuters reports U.S. futures modestly higher as oil eases ahead of the Fed decision and Alphabet/Microsoft/Amazon earnings; AI infrastructure financing remains under scrutiny. CoinDesk reports BTC near $80,000 amid cautious positioning; Alpaca's 13:23 UTC BTC trade was $79,903.80, ETH $2,315.90, SOL $101.20 (timestamps differ). Study QQQ/NVDA/MSFT and crypto regime transitions as timestamped research only. Sources: https://www.reuters.com/world/asia-pacific/global-markets-pix-2026-10-26/ ; https://www.coindesk.com/markets/2026/10/26/bitcoin-holds-near-usd80-000-as-oil-retreats-and-the-fed-decision-looms .

,318, SOL ~## 10. Market-regime and leveraged-instrument event studies
00 (venue timestamps differ). SOFI earnings and JBLU results explain two current scanner moves; record first eligible times and compare to independently timestamped releases, not hindsight-selected entries. Sources: https://www.reuters.com/business/us-stock-futures-edge-up-oil-falls-heading-into-earnings-barrage-2026-10-26/ ; https://www.coindesk.com/tech/2026/10/27/live-updates-bitcoin-holds-below-usd80-000-as-ai-buildout-draws-more-capital .

## 11. AI Clipper staged acceptance

**Status:** Evaluate / PR stack open  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-23

**Evidence:** PRs #137–#141 implement staged YouTube discovery, URL intake, quota reservations, and disposable PostgreSQL tests; none merged. Real YouTube API/OAuth integration and approved migrations remain unverified.

**Possible solution:** Review dependencies in order; test restricted API keys, verified video-owner metadata, RLS/tenant isolation, quotas, and authorized content processing in nonproduction.

**Recommendation:** Do not merge, deploy, or migrate until independently verified and approved.

## 12. Node runtime and dependency supply-chain exposure

**Status:** Evaluate / read-only audit  
**Added:** 2026-10-23  
**Last reviewed:** 2026-10-23

**Evidence:** Node.js released security fixes Oct 21 (22.23.4, 24.22.1, 26.12.1). LiteLLM v1.107.0 distribution was compromised Oct 21; no direct dependency was identified in the previously reviewed manifests, but runtime/transitive exposure has not been verified.

**Possible solution:** Inventory actual CI/production Node patch levels and worker/container dependency digests before any changes.

**Recommendation:** Patch or rotate credentials only after exposure is established and remediation is approved; never assume lack of a direct dependency proves safety.

**References:** https://nodejs.org/en/blog/vulnerability/october-2026-security-releases ; https://docs.litellm.ai/blog/security-incident-oct-21-2026
