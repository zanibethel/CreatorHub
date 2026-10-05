# Things to Consider — CreatorHub

Living backlog of external findings, possible upgrades, trading-research observations, and solution ideas that may improve CreatorHub.

These are **not approved implementation tasks**. Re-validate every item against current code, current data, and current market/provider conditions before implementation. New market/news signals may inform research but must not directly bypass trading risk gates.

Last reviewed: 2026-10-05

## Status key

- **Consider** — useful signal; needs research.
- **Evaluate** — worth testing/backtesting.
- **Recommend** — evidence supports implementation; still requires approval.
- **Approved** — user explicitly approved implementation.
- **Implemented** — landed and verified.
- **Rejected / Superseded** — intentionally not pursuing.

---

## 1. Add verified news/catalyst context to trading research

**Status:** Evaluate  
**Added:** 2026-10-05

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

### Recommendation
Do **not** let a newsletter mention create an entry signal or override spread/liquidity/risk gates.

---

## 2. Prospect Scanner cadence is configured for 10 minutes

**Status:** Recommend review  
**Added:** 2026-10-05

### Finding
`src/lib/paper-prospect-scanner-config.ts` currently contains:

```ts
cadenceMinutes: 10
```

The intended working cadence discussed for discovery has been five minutes.

### Why it may matter
For momentum/squeeze discovery, a ten-minute interval can materially delay observation of a developing move. A five-minute cadence provides more granular observations but increases API calls, duplicate samples, and storage.

### Possible solution
Before changing:
1. confirm scheduler/runtime is also using this config rather than a separate external schedule;
2. calculate provider/API and database load;
3. ensure idempotency/deduplication;
4. change the canonical cadence to five minutes;
5. verify actual run timestamps in persistence.

### Recommendation
Move to five minutes if current provider limits and scheduler behavior support it, but verify the end-to-end cadence rather than changing only the displayed/config value.

---

## 3. 2026-10-05 prepared swing candidates received market confirmation but still require revalidation

**Status:** Time-sensitive observation  
**Added:** 2026-10-05

### Finding
The prepared swing candidates QQQ, NVDA, and MSFT traded into/near their previously staged entry regions during a strong technology/Nasdaq session.

Current research snapshot near the close:
- QQQ about $755.92; prepared trigger about $755.26.
- NVDA about $238.90; prepared trigger about $238.07.
- MSFT about $526.27; prepared trigger about $522.98.

### Why it may matter
This supports the original continuation/breakout thesis but does not replace the strategy's required revalidation.

### Recommendation
Treat this as evidence for the journal/counterfactual system. Do not hard-code or permanently boost these symbols because of one session.

---

## 4. Crypto volume expansion without clean bot-review qualification

**Status:** Monitor  
**Added:** 2026-10-05

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

### Recommendation
Collect evidence before changing score weights.

---

## 5. Squeeze liquidity gates appear to be protecting against headline-chasing

**Status:** Monitor / validation evidence  
**Added:** 2026-10-05

### Finding
BSBR was the strongest current squeeze candidate in the reviewed snapshot but remained below the watchlist threshold. FNGR showed a notable positive session move while the scanner still rejected it because the observed setup/liquidity quality was poor, including a very wide quoted spread in the snapshot.

### Why it may matter
This is the behavior we want: price movement alone should not qualify a squeeze trade.

### Recommendation
Preserve spread/liquidity gates. Use future outcomes to test whether thresholds are too strict or appropriately filtering false positives rather than loosening them because an individual rejected symbol later moves.

---

## 6. Daily intelligence should feed research, not silently rewrite the algorithm

**Status:** Recommend  
**Added:** 2026-10-05

### Possible solution
For market/news findings:
1. verify the claim;
2. attach it to relevant symbols/regimes as research metadata;
3. record the algorithm version and candidate state at the time;
4. measure subsequent outcomes;
5. propose an algorithm change with evidence;
6. require explicit approval before changing scoring/risk/execution logic.

### Recommendation
Keep scanner/risk changes versioned and evidence-based. Live execution remains out of scope unless separately and explicitly approved.
