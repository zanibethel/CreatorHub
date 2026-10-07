# Things to Consider — CreatorHub

Living backlog of external findings, possible upgrades, trading-research observations, and solution ideas that may improve CreatorHub.

These are **not approved implementation tasks**. Re-validate every item against current code, current data, and current market/provider conditions before implementation. New market/news signals may inform research but must not directly bypass trading risk gates.

Last reviewed: 2026-10-07

## Status key

- **Consider** — useful signal; needs research.
- **Evaluate** — worth testing/backtesting.
- **Recommend** — evidence supports implementation; still requires approval.
- **Approved** — user explicitly approved implementation.
- **Implemented** — landed and verified.
- **Rejected / Superseded** — intentionally not pursuing.

---

## 1. Add verified news/catalyst context to trading research

**Status:** Implemented foundation / validate live evidence  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-07

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

### Recommendation
Do **not** let a newsletter mention create an entry signal or override spread/liquidity/risk gates.

---

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

**Status:** Monitor  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-06

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

### Recommendation
Collect evidence before changing score weights. The latest outcomes support retaining the existing quote, spread, trend, breakout, fee-coverage, score, and BTC-regime gates.

Reference: https://www.coindesk.com/markets/2026/10/06/bitcoin-keeps-getting-rejected-at-usd87-000-as-stocks-hover-near-records

---

## 5. Squeeze liquidity gates appear to be protecting against headline-chasing

**Status:** Monitor / stronger validation evidence  
**Added:** 2026-10-05  
**Last reviewed:** 2026-10-06

### Finding
BSBR was the strongest current squeeze candidate in the reviewed snapshot but remained below the watchlist threshold. FNGR showed a notable positive session move while the scanner still rejected it because the observed setup/liquidity quality was poor, including a very wide quoted spread in the snapshot.

### Why it may matter
This is the behavior we want: price movement alone should not qualify a squeeze trade.

### 2026-10-06 evidence update
At about 8:57 a.m. Central, FNGR was about $0.2467 and down roughly 8.6% after the prior session's positive move. BSBR was about $5.80 and up only about 0.35%. This is consistent with the scanner refusing to promote a flashy but poor-liquidity move and supports retaining the existing gates.

### 2026-10-07 evidence update
OPCH was retained by the squeeze scanner as a watchlist item but was not bot-review eligible. Its acquisition-driven gap is not evidence to weaken squeeze gates: it was already roughly 33% higher when first retained. Very wide-spread, low-dollar-volume names in the same snapshot remained ineligible.

### Recommendation
Preserve spread/liquidity gates. Use future outcomes to test whether thresholds are too strict or appropriately filtering false positives rather than loosening them because an individual rejected symbol later moves.

---

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
