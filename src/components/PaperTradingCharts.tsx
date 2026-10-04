"use client";

import type { PaperChartCandle } from "./usePaperChartData";
import styles from "./PaperTradingLab.module.css";

type Point = { time:string; value:number };
type ScorePoint = { time:string; score:number };

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number) => new Intl.NumberFormat("en-US", {
  style:"currency",
  currency:"USD",
  maximumFractionDigits:value < 1 ? 4 : 2,
}).format(value);

function bounds(values: number[]) {
  const valid = values.filter(finite);
  if (!valid.length) return { min:0, max:1 };
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 1);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

function linePath(values: number[], min: number, max: number, width: number, height: number, top = 10, bottom = 10) {
  if (!values.length) return "";
  const usableHeight = height - top - bottom;
  const xStep = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value,index) => {
    const x = index * xStep;
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const y = top + (1 - ratio) * usableHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function yFor(value: number, min: number, max: number, height: number, top = 10, bottom = 10) {
  const usableHeight = height - top - bottom;
  const ratio = max === min ? 0.5 : (value - min) / (max - min);
  return top + (1 - ratio) * usableHeight;
}

export function EquityCurve({ points, startingCash }: {
  points: Array<{time:string; equity:number}>;
  startingCash: number;
}) {
  const clean = points
    .filter(point => finite(point.equity) && point.equity >= 0)
    .map(point => ({ time:point.time, value:point.equity }));
  if (!clean.length) {
    return <div className={styles.chartEmpty}>Equity history will appear as checkpoints accumulate.</div>;
  }

  const width = 720;
  const height = 190;
  const values = clean.map(point => point.value);
  const {min,max} = bounds([...values,startingCash]);
  const path = linePath(values,min,max,width,height,12,24);
  const baselineY = yFor(startingCash,min,max,height,12,24);
  const first = values[0];
  const last = values.at(-1) ?? first;
  const change = last - first;
  const changePct = first > 0 ? change / first * 100 : 0;

  return <div className={styles.chartBlock}>
    <div className={styles.chartSummary}>
      <span><small>Start</small><strong>{money(first)}</strong></span>
      <span><small>Current</small><strong>{money(last)}</strong></span>
      <span><small>Change</small><strong>{change >= 0 ? "+" : ""}{money(change)} · {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%</strong></span>
    </div>
    <svg className={styles.equityChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bot equity curve">
      <line className={styles.chartGridLine} x1="0" x2={width} y1={baselineY} y2={baselineY} />
      <text className={styles.chartAxisLabel} x="6" y={Math.max(12,baselineY - 5)}>Start {money(startingCash)}</text>
      <path className={styles.chartLinePrimary} d={path} />
      <circle className={styles.chartPoint} cx={width} cy={yFor(last,min,max,height,12,24)} r="4" />
      <text className={styles.chartAxisLabel} x="6" y={height - 5}>{new Date(clean[0].time).toLocaleDateString()}</text>
      <text className={styles.chartAxisLabel} x={width - 6} y={height - 5} textAnchor="end">{new Date(clean.at(-1)!.time).toLocaleDateString()}</text>
    </svg>
  </div>;
}

export function PricePlanChart({ candles, current, entry, fill, stop, target, timeframe, compact = false }: {
  candles: PaperChartCandle[];
  current?: number | null;
  entry?: number | null;
  fill?: number | null;
  stop?: number | null;
  target?: number | null;
  timeframe?: string | null;
  compact?: boolean;
}) {
  const clean = candles.filter(candle => finite(candle.close) && candle.close > 0);
  if (clean.length < 2) {
    return <div className={styles.chartEmptyCompact}>Price history loading…</div>;
  }

  const width = 420;
  const height = compact ? 112 : 148;
  const prices = clean.flatMap(candle => [
    candle.close,
    ...(finite(candle.high) ? [candle.high] : []),
    ...(finite(candle.low) ? [candle.low] : []),
  ]);
  const refs = [current,entry,fill,stop,target].filter((value): value is number => finite(value) && value > 0);
  const {min,max} = bounds([...prices,...refs]);
  const path = linePath(clean.map(candle => candle.close),min,max,width,height,9,18);
  const markers = [
    { key:"target", label:"Goal", value:target, className:styles.chartMarkerTarget },
    { key:"entry", label:fill ? "Plan" : "Entry", value:entry, className:styles.chartMarkerEntry },
    { key:"fill", label:"Fill", value:fill, className:styles.chartMarkerFill },
    { key:"stop", label:"Stop", value:stop, className:styles.chartMarkerStop },
    { key:"current", label:"Now", value:current, className:styles.chartMarkerCurrent },
  ].filter(item => finite(item.value) && (item.value as number) > 0);

  return <div className={styles.priceChartWrap}>
    <div className={styles.priceChartMeta}>
      <small>{timeframe ?? "Price"} chart</small>
      <span>{clean.length} bars</span>
    </div>
    <svg className={styles.priceChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price chart with trade plan levels">
      <path className={styles.chartLinePrimary} d={path} />
      {markers.map(item => {
        const value = item.value as number;
        const y = yFor(value,min,max,height,9,18);
        return <g key={item.key}>
          <line className={item.className} x1="0" x2={width} y1={y} y2={y} />
          <text className={styles.chartMarkerLabel} x={width - 4} y={Math.max(10,y - 3)} textAnchor="end">{item.label} {money(value)}</text>
        </g>;
      })}
      <text className={styles.chartAxisLabel} x="4" y={height - 4}>{new Date(clean[0].time).toLocaleDateString()}</text>
      <text className={styles.chartAxisLabel} x={width - 4} y={height - 4} textAnchor="end">{new Date(clean.at(-1)!.time).toLocaleDateString()}</text>
    </svg>
  </div>;
}

export function ScoreSparkline({ points, compact = true }: { points: ScorePoint[]; compact?: boolean }) {
  const clean = points.filter(point => finite(point.score)).slice(-60);
  if (clean.length < 2) return null;
  const width = 320;
  const height = compact ? 64 : 100;
  const path = linePath(clean.map(point => point.score),0,100,width,height,7,7);
  const y65 = yFor(65,0,100,height,7,7);
  const y80 = yFor(80,0,100,height,7,7);
  const latest = clean.at(-1)!.score;

  return <div className={styles.scoreChartWrap}>
    <svg className={styles.scoreChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Prospect score trend">
      <line className={styles.scoreThresholdWatch} x1="0" x2={width} y1={y65} y2={y65} />
      <line className={styles.scoreThresholdReview} x1="0" x2={width} y1={y80} y2={y80} />
      <path className={styles.chartLinePrimary} d={path} />
      <circle className={styles.chartPoint} cx={width} cy={yFor(latest,0,100,height,7,7)} r="3" />
    </svg>
    <div className={styles.scoreChartLegend}><span>65 watch</span><span>80 bot review</span></div>
  </div>;
}

export function TradeOutcomeChart({ trades }: {
  trades: Array<{symbol:string; realized_pl:number | null; r_multiple:number | null}>;
}) {
  const clean = trades.filter(trade => trade.realized_pl !== null).slice(0,12).reverse();
  if (!clean.length) return <div className={styles.chartEmpty}>Closed-trade outcomes will appear here after round trips complete.</div>;
  const width = 720;
  const height = 170;
  const values = clean.map(trade => trade.realized_pl ?? 0);
  const maxAbs = Math.max(0.01,...values.map(value => Math.abs(value)));
  const mid = height / 2;
  const slot = width / clean.length;
  return <div className={styles.chartBlock}>
    <svg className={styles.outcomeChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent closed trade profit and loss chart">
      <line className={styles.chartGridLine} x1="0" x2={width} y1={mid} y2={mid} />
      {clean.map((trade,index) => {
        const value = trade.realized_pl ?? 0;
        const barHeight = Math.max(2,Math.abs(value) / maxAbs * (mid - 24));
        const x = index * slot + slot * 0.18;
        const y = value >= 0 ? mid - barHeight : mid;
        return <g key={`${trade.symbol}-${index}`}>
          <rect className={value >= 0 ? styles.outcomeGain : styles.outcomeLoss} x={x} y={y} width={slot * 0.64} height={barHeight} rx="3" />
          <text className={styles.chartAxisLabel} x={x + slot * 0.32} y={height - 5} textAnchor="middle">{trade.symbol.replace("/USD","")}</text>
          <text className={styles.chartValueLabel} x={x + slot * 0.32} y={value >= 0 ? Math.max(10,y - 4) : Math.min(height - 18,y + barHeight + 12)} textAnchor="middle">{value >= 0 ? "+" : ""}{money(value)}</text>
        </g>;
      })}
    </svg>
  </div>;
}
