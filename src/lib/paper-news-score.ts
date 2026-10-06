import { PAPER_PROSPECT_SCANNER_V2 as config } from "./paper-prospect-scanner-config";

export type PaperNewsSignalRow = {
  symbol: string;
  news_score: number | string;
  confidence_score: number | string;
  source_name: string;
  headline: string;
  published_at: string;
};

export type PaperNewsAggregate = {
  newsScore: number;
  scannerImpact: number;
  botImpact: number;
  evidenceCount: number;
  updatedAt: string | null;
  evidence: Array<{
    sourceName: string;
    headline: string;
    newsScore: number;
    publishedAt: string;
  }>;
};

const finite = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Number(value.toFixed(2));

export function canonicalPaperNewsSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace("-", "/");
}

export function newsImpactFromScore(score: number, maximumPoints: number) {
  return round(clamp(score / 100 * maximumPoints, -maximumPoints, maximumPoints));
}

export function aggregatePaperNewsSignals(rows: PaperNewsSignalRow[]) {
  const grouped = new Map<string, PaperNewsSignalRow[]>();
  for (const row of rows) {
    const confidence = finite(row.confidence_score);
    const score = finite(row.news_score);
    if (confidence === null || confidence < config.news.minimumConfidenceScore || score === null) continue;
    const symbol = canonicalPaperNewsSymbol(row.symbol);
    const bucket = grouped.get(symbol) ?? [];
    bucket.push(row);
    grouped.set(symbol, bucket);
  }

  const result = new Map<string, PaperNewsAggregate>();
  for (const [symbol, rawRows] of grouped) {
    // Avoid letting several stories from the same publisher multiply one narrative.
    const strongestBySource = new Map<string, PaperNewsSignalRow>();
    for (const row of rawRows) {
      const source = row.source_name.trim().toLowerCase() || "unknown";
      const current = strongestBySource.get(source);
      const nextAbs = Math.abs(finite(row.news_score) ?? 0);
      const currentAbs = Math.abs(finite(current?.news_score) ?? -1);
      if (!current || nextAbs > currentAbs) strongestBySource.set(source, row);
    }

    const selected = [...strongestBySource.values()]
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, config.news.maxSignalsPerSymbol);

    const weighted = selected
      .map(row => ({
        row,
        score: finite(row.news_score) ?? 0,
        weight: clamp((finite(row.confidence_score) ?? 0) / 100, 0, 1),
      }))
      .filter(item => item.weight > 0);

    const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
    const newsScore = weightTotal > 0
      ? round(clamp(weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / weightTotal, -100, 100))
      : 0;

    result.set(symbol, {
      newsScore,
      scannerImpact: newsImpactFromScore(newsScore, config.news.maxScannerImpactPoints),
      botImpact: newsImpactFromScore(newsScore, config.news.maxBotImpactPoints),
      evidenceCount: selected.length,
      updatedAt: selected[0]?.published_at ?? null,
      evidence: selected.map(row => ({
        sourceName: row.source_name,
        headline: row.headline,
        newsScore: round(finite(row.news_score) ?? 0),
        publishedAt: row.published_at,
      })),
    });
  }
  return result;
}
