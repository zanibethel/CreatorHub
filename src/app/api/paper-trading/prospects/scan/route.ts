import { NextResponse } from "next/server";
import { fetchPreferredStockQuotes } from "@/lib/live-stock-market-data";
import { PAPER_PROSPECT_SCANNER_V2 as config } from "@/lib/paper-prospect-scanner-config";
import { aggregatePaperNewsSignals, type PaperNewsSignalRow } from "@/lib/paper-news-score";
import {
  prospectVolumeRatio,
  scoreProspect,
  type ProspectAssetClass,
  type ProspectScoreInput,
} from "@/lib/paper-prospect-scanner";
import { DEFAULT_PAPER_WATCHLIST } from "@/lib/paper-watchlist";
import { ACTIVE_DAILY_CRYPTO_DAY_STRATEGY } from "@/lib/paper-weekend-crypto-strategy-config";

export const dynamic = "force-dynamic";

const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

type JsonRecord = Record<string, unknown>;

type NormalizedProspect = ProspectScoreInput & {
  sourceUpdatedAt: string | null;
  metadata: Record<string, unknown>;
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: unknown) {
  const valueString = str(value);
  return valueString && Number.isFinite(Date.parse(valueString)) ? valueString : null;
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function spreadPct(snapshot: JsonRecord) {
  const quote = record(snapshot.latestQuote);
  const bid = num(quote.bp);
  const ask = num(quote.ap);
  if (!(bid && ask && ask >= bid)) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid * 100 : null;
}

function snapshotMetrics(snapshot: JsonRecord) {
  const daily = record(snapshot.dailyBar);
  const previous = record(snapshot.prevDailyBar);
  const trade = record(snapshot.latestTrade);
  const minute = record(snapshot.minuteBar);
  const quote = record(snapshot.latestQuote);
  const bid = num(quote.bp);
  const ask = num(quote.ap);
  const quoteMid = bid !== null && ask !== null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
  const price = quoteMid ?? num(trade.p) ?? num(minute.c) ?? num(daily.c);
  const previousClose = num(previous.c);
  const change = price !== null && previousClose !== null && previousClose > 0
    ? (price / previousClose - 1) * 100
    : null;
  const high = num(daily.h);
  const nearHigh = price !== null && high !== null && high > 0
    ? Math.max(0, (high - price) / high * 100)
    : null;
  return {
    price,
    percentChange: change,
    spreadPct: spreadPct(snapshot),
    volume: num(daily.v),
    previousVolume: num(previous.v),
    nearHighPct: nearHigh,
    quoteAt: iso(record(snapshot.latestQuote).t),
    dailyAt: iso(daily.t),
  };
}

function sourceAgeMinutes(timestamp: string | null, now: number) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - Date.parse(timestamp)) / 60_000);
}

function canonical(value: string) {
  return value.replace("-", "/").toUpperCase();
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return reply({ error: "Unauthorized." }, 401);
  }

  const alpacaKey = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!alpacaKey || !alpacaSecret || !supabaseSecret) {
    return reply({ error: "Prospect scanner dependencies are not configured." }, 503);
  }

  const alpacaHeaders = {
    "APCA-API-KEY-ID": alpacaKey,
    "APCA-API-SECRET-KEY": alpacaSecret,
    Accept: "application/json",
  };

  const fetchJson = async (url: string) => {
    const response = await fetch(url, {
      headers: alpacaHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Prospect market-data source returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  };

  const now = Date.now();
  const scannedAt = new Date(now).toISOString();

  const newsDbHeaders: Record<string,string> = {
    apikey: supabaseSecret,
    Accept: "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) newsDbHeaders.Authorization = `Bearer ${supabaseSecret}`;
  const activeNewsResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/paper_news_signals?select=symbol,news_score,confidence_score,source_name,headline,published_at&verified=eq.true&confidence_score=gte.${config.news.minimumConfidenceScore}&expires_at=gt.${encodeURIComponent(scannedAt)}&order=published_at.desc&limit=500`,
    {
      headers: newsDbHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const activeNewsRows = activeNewsResponse.ok
    ? await activeNewsResponse.json() as PaperNewsSignalRow[]
    : [];
  const newsBySymbol = aggregatePaperNewsSignals(activeNewsRows);

  const [stockMoversRaw, stockActiveRaw, cryptoMoversRaw, cryptoAssetsRaw] = await Promise.all([
    fetchJson(`${DATA_URL}/v1beta1/screener/stocks/movers?top=${config.stock.topMovers}`),
    fetchJson(`${DATA_URL}/v1beta1/screener/stocks/most-actives?by=volume&top=${config.stock.mostActive}`),
    fetchJson(`${DATA_URL}/v1beta1/screener/crypto/movers?top=50`),
    fetchJson(`${TRADING_URL}/v2/assets?status=active&asset_class=crypto`),
  ]);

  const stockMovers = record(stockMoversRaw);
  const stockActive = record(stockActiveRaw);
  const cryptoMovers = record(cryptoMoversRaw);
  const stockSourceUpdatedAt = [iso(stockMovers.last_updated), iso(stockActive.last_updated)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const stockSourceFresh = sourceAgeMinutes(stockSourceUpdatedAt, now) <= config.freshness.stockSourceMinutes;

  const stockMoverMap = new Map<string, { rank: number; percentChange: number | null; price: number | null }>();
  array(stockMovers.gainers).forEach((raw, index) => {
    const item = record(raw);
    const symbol = str(item.symbol)?.toUpperCase();
    if (!symbol) return;
    stockMoverMap.set(symbol, {
      rank: index + 1,
      percentChange: num(item.percent_change),
      price: num(item.price),
    });
  });

  const stockActivityMap = new Map<string, { rank: number; volume: number | null; tradeCount: number | null }>();
  array(stockActive.most_actives).forEach((raw, index) => {
    const item = record(raw);
    const symbol = str(item.symbol)?.toUpperCase();
    if (!symbol) return;
    stockActivityMap.set(symbol, {
      rank: index + 1,
      volume: num(item.volume),
      tradeCount: num(item.trade_count),
    });
  });

  const stockSymbols = [...new Set([...stockMoverMap.keys(), ...stockActivityMap.keys()])]
    .filter(symbol => /^[A-Z][A-Z0-9]{0,5}$/.test(symbol));

  const liveStockBatch = stockSourceFresh
    ? await fetchPreferredStockQuotes(stockSymbols)
    : await fetchPreferredStockQuotes([]);
  const stockPreviousVolume = new Map<string, number | null>();
  if (stockSourceFresh && stockSymbols.length) {
    const historyStart = new Date(now - 10 * 86_400_000).toISOString();
    const historyEnd = new Date(now - 24 * 60 * 60_000).toISOString();
    for (const batch of chunk(stockSymbols, 45)) {
      if (!batch.length) continue;
      const raw = record(await fetchJson(
        `${DATA_URL}/v2/stocks/bars?symbols=${encodeURIComponent(batch.join(","))}&timeframe=1Day&limit=1000&feed=sip&adjustment=split&sort=asc&start=${encodeURIComponent(historyStart)}&end=${encodeURIComponent(historyEnd)}`,
      ));
      const barsRoot = record(raw.bars);
      for (const symbol of batch) {
        const bars = array(barsRoot[symbol]).map(record);
        stockPreviousVolume.set(symbol, bars.length ? num(bars.at(-1)?.v) : null);
      }
    }
  }

  const cryptoAssets = array(cryptoAssetsRaw)
    .map(record)
    .filter(asset =>
      asset.tradable === true
      && asset.fractionable === true
      && str(asset.symbol)?.toUpperCase().endsWith("/USD")
    );
  const cryptoSymbols = cryptoAssets.map(asset => str(asset.symbol)!.toUpperCase());
  const cryptoAssetNames = new Map(
    cryptoAssets.map(asset => [str(asset.symbol)!.toUpperCase(), str(asset.name)] as const),
  );
  const cryptoMoverMap = new Map<string, { rank: number; percentChange: number | null; price: number | null }>();
  array(cryptoMovers.gainers).forEach((raw, index) => {
    const item = record(raw);
    const symbol = str(item.symbol)?.toUpperCase();
    if (!symbol || !symbol.endsWith("/USD")) return;
    cryptoMoverMap.set(symbol, {
      rank: index + 1,
      percentChange: num(item.percent_change),
      price: num(item.price),
    });
  });

  const cryptoSnapshots: Record<string, JsonRecord> = {};
  for (const batch of chunk(cryptoSymbols, 40)) {
    if (!batch.length) continue;
    const payload = record(await fetchJson(
      `${DATA_URL}/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(batch.join(","))}`,
    ));
    const snapshots = record(payload.snapshots);
    for (const [symbol, value] of Object.entries(snapshots)) cryptoSnapshots[symbol] = record(value);
  }

  const normalized: NormalizedProspect[] = [];

  if (stockSourceFresh) {
    for (const symbol of stockSymbols) {
      const quote = liveStockBatch.quotes[symbol];
      if (!quote) continue;
      const mover = stockMoverMap.get(symbol);
      const activity = stockActivityMap.get(symbol);
      const midpoint = quote.bid !== null && quote.ask !== null && quote.bid > 0 && quote.ask >= quote.bid
        ? (quote.bid + quote.ask) / 2
        : null;
      const price = midpoint ?? quote.last ?? quote.close ?? mover?.price ?? null;
      if (price === null || price < config.stock.minimumPriceUsd) continue;
      const previousClose = quote.previousClose;
      const computedChange = previousClose !== null && previousClose > 0 ? (price / previousClose - 1) * 100 : null;
      const percentChange = mover?.percentChange ?? quote.changePct ?? computedChange;
      const spread = quote.bid !== null && quote.ask !== null && quote.bid > 0 && quote.ask >= quote.bid
        ? (quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2) * 100
        : null;
      const nearHigh = quote.high !== null && quote.high > 0
        ? Math.max(0, (quote.high - price) / quote.high * 100)
        : null;
      const sourceFlags = [
        ...(mover ? ["top stock gainer"] : []),
        ...(activity ? ["most-active stock"] : []),
      ];
      normalized.push({
        assetClass: "stock",
        symbol,
        price,
        percentChange,
        spreadPct: spread,
        volume: quote.volume ?? activity?.volume ?? null,
        previousVolume: stockPreviousVolume.get(symbol) ?? null,
        activityRank: activity?.rank ?? null,
        nearHighPct: nearHigh,
        sourceFlags,
        sourceUpdatedAt: quote.timestamp ?? stockSourceUpdatedAt,
        metadata: {
          moverRank: mover?.rank ?? null,
          tradeCount: activity?.tradeCount ?? null,
          marketVolume: activity?.volume ?? null,
          quoteAt: quote.timestamp,
          marketDataSource: liveStockBatch.source,
          marketDataFallback: liveStockBatch.fallback,
          marketDataProviderError: liveStockBatch.providerError,
          historyDataSource: "alpaca-sip-completed",
        },
      });
    }
  }

  for (const symbol of cryptoSymbols) {
    const snapshot = cryptoSnapshots[symbol];
    if (!snapshot || !Object.keys(snapshot).length) continue;
    const metrics = snapshotMetrics(snapshot);
    if (sourceAgeMinutes(metrics.quoteAt, now) > config.freshness.cryptoQuoteMinutes) continue;
    const mover = cryptoMoverMap.get(symbol);
    normalized.push({
      assetClass: "crypto",
      symbol,
      price: metrics.price ?? mover?.price ?? null,
      percentChange: mover?.percentChange ?? metrics.percentChange,
      spreadPct: metrics.spreadPct,
      volume: metrics.volume,
      previousVolume: metrics.previousVolume,
      activityRank: null,
      nearHighPct: metrics.nearHighPct,
      sourceFlags: mover ? ["top crypto gainer"] : ["broad crypto universe"],
      sourceUpdatedAt: metrics.quoteAt,
      metadata: {
        moverRank: mover?.rank ?? null,
        assetName: cryptoAssetNames.get(symbol) ?? null,
        quoteAt: metrics.quoteAt,
        snapshotDay: metrics.dailyAt,
      },
    });
  }

  const known = new Set<string>([
    ...DEFAULT_PAPER_WATCHLIST.stocks.map(item => canonical(item.symbol)),
    ...DEFAULT_PAPER_WATCHLIST.crypto.map(item => canonical(item.symbol)),
    ...ACTIVE_DAILY_CRYPTO_DAY_STRATEGY.universe.map(item => canonical(item)),
  ]);

  const provisional = normalized.map(input => {
    const news = newsBySymbol.get(canonical(input.symbol)) ?? null;
    const scored = scoreProspect({
      ...input,
      newsImpact: news?.scannerImpact ?? 0,
    });
    return { input, scored, news };
  });

  const stockNeedsValidation = provisional
    .filter(item => item.input.assetClass === "stock" && item.scored.watchlistEligible)
    .map(item => item.input.symbol);

  const stockValidation = new Map<string, { valid: boolean; name: string | null }>();
  for (const validationBatch of chunk(stockNeedsValidation, 10)) {
    await Promise.all(validationBatch.map(async symbol => {
      try {
        const asset = record(await fetchJson(`${TRADING_URL}/v2/assets/${encodeURIComponent(symbol)}`));
        stockValidation.set(symbol, {
          valid: asset.status === "active" && asset.tradable === true && asset.fractionable === true,
          name: str(asset.name),
        });
      } catch {
        stockValidation.set(symbol, { valid: false, name: null });
      }
    }));
  }

  const rows = provisional.map(({ input, scored, news }) => {
    const validation = input.assetClass === "stock" && scored.watchlistEligible
      ? stockValidation.get(input.symbol)
      : null;
    const qualified = validation?.valid === false
      ? {
          ...scored,
          status: "candidate" as const,
          watchlistEligible: false,
          botReviewEligible: false,
          suggestedBotIds: [],
          reasons: [...scored.reasons, "Market-catalog validation did not pass"],
        }
      : scored;
    return {
      asset_class: input.assetClass,
      symbol: input.symbol,
      scanner_id: config.id,
      scanner_version: config.version,
      status: qualified.status,
      score: qualified.score,
      news_score: news?.newsScore ?? 0,
      news_scanner_impact: news?.scannerImpact ?? 0,
      news_bot_impact: news?.botImpact ?? 0,
      news_evidence_count: news?.evidenceCount ?? 0,
      news_score_updated_at: news?.updatedAt ?? null,
      price: input.price,
      percent_change: input.percentChange,
      spread_pct: input.spreadPct,
      volume: input.volume,
      previous_volume: input.previousVolume,
      volume_ratio: prospectVolumeRatio(input.volume, input.previousVolume),
      activity_rank: input.activityRank,
      near_high_pct: input.nearHighPct,
      watchlist_eligible: qualified.watchlistEligible,
      bot_review_eligible: qualified.botReviewEligible,
      suggested_bot_ids: qualified.suggestedBotIds,
      assigned_bot_ids: qualified.botReviewEligible ? qualified.suggestedBotIds : [],
      score_components: qualified.components,
      reasons: qualified.reasons,
      source_flags: input.sourceFlags,
      source_updated_at: input.sourceUpdatedAt,
      first_seen_at: scannedAt,
      last_seen_at: scannedAt,
      last_scanned_at: scannedAt,
      metadata: {
        ...input.metadata,
        alreadyKnown: known.has(canonical(input.symbol)),
        validatedAssetName: validation?.name ?? null,
        discoveryOnly: true,
        orderAuthorization: false,
        newsEvidence: news?.evidence ?? [],
      },
    };
  });

  const dbHeaders: Record<string,string> = {
    apikey: supabaseSecret,
    "Content-Type": "application/json",
  };
  if (supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const write = async (path: string, body: unknown, prefer?: string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "POST",
      headers: { ...dbHeaders, ...(prefer ? { Prefer: prefer } : {}) },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Prospect scanner storage returned HTTP ${response.status}.`);
  };

  if (rows.length) {
    await write(
      "paper_prospects?on_conflict=asset_class,symbol",
      rows,
      "resolution=merge-duplicates,return=minimal",
    );
  }

  const observations = rows
    .filter(row => row.score >= config.thresholds.observationScore)
    .map(row => ({
      scanned_at: scannedAt,
      scanner_id: row.scanner_id,
      scanner_version: row.scanner_version,
      asset_class: row.asset_class,
      symbol: row.symbol,
      status: row.status === "expired" ? "candidate" : row.status,
      score: row.score,
      news_score: row.news_score,
      news_scanner_impact: row.news_scanner_impact,
      news_bot_impact: row.news_bot_impact,
      news_evidence_count: row.news_evidence_count,
      news_score_updated_at: row.news_score_updated_at,
      price: row.price,
      percent_change: row.percent_change,
      spread_pct: row.spread_pct,
      volume: row.volume,
      volume_ratio: row.volume_ratio,
      activity_rank: row.activity_rank,
      near_high_pct: row.near_high_pct,
      watchlist_eligible: row.watchlist_eligible,
      bot_review_eligible: row.bot_review_eligible,
      suggested_bot_ids: row.suggested_bot_ids,
      score_components: row.score_components,
      reasons: row.reasons,
      source_flags: row.source_flags,
      metadata: row.metadata,
    }));

  if (observations.length) await write("paper_prospect_observations", observations, "return=minimal");
  await write("rpc/paper_expire_stale_prospects", { p_now: scannedAt });

  const watchlistReady = rows.filter(row => row.watchlist_eligible).length;
  const botReviewReady = rows.filter(row => row.bot_review_eligible).length;
  const newProspects = rows.filter(row => row.watchlist_eligible && row.metadata.alreadyKnown !== true).length;

  return reply({
    ok: true,
    paperResearchOnly: true,
    scannerId: config.id,
    scannerVersion: config.version,
    scannedAt,
    thresholds: config.thresholds,
    sources: {
      stockSourceUpdatedAt,
      stockSourceFresh,
      stockCandidates: stockSourceFresh ? stockSymbols.length : 0,
      stockMarketDataSource: liveStockBatch.source,
      stockMarketDataFallback: liveStockBatch.fallback,
      stockHistorySource: "alpaca-sip-completed",
      cryptoCandidates: cryptoSymbols.length,
      activeVerifiedNewsSignals: activeNewsRows.length,
      symbolsWithNewsScore: newsBySymbol.size,
    },
    results: {
      evaluated: rows.length,
      observationsSaved: observations.length,
      watchlistReady,
      botReviewReady,
      newProspects,
    },
  });
}
