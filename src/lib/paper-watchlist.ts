import { z } from "zod";
import selection from "../../research/paper-watchlist/selection.json";
const entry = z.object({
  symbol: z.string(), label: z.string().max(100), role: z.string().max(100),
  pools: z.array(z.enum(["day","multi-day","multi-week"])), rationale: z.string().max(500),
  return1y: z.number().finite(), volatility: z.number().finite().nonnegative(),
  maxDrawdown: z.number().finite().nonpositive(), fractionable: z.boolean(), tradable: z.boolean(),
});
export const watchlistSchema = z.object({
  version: z.number().int().positive(), reviewedAt: z.iso.datetime(), dataThrough: z.iso.date(),
  model: z.string().max(500), stocks: z.array(entry.extend({symbol:z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/)})).max(10),
  crypto: z.array(entry.extend({symbol:z.string().regex(/^[A-Z0-9]{2,12}-USD$/)})).max(10),
}).refine(value => value.stocks.length + value.crypto.length > 0, "Watchlist cannot be empty");
export type PaperWatchlist = z.infer<typeof watchlistSchema>;
export const DEFAULT_PAPER_WATCHLIST: PaperWatchlist = watchlistSchema.parse(selection);
