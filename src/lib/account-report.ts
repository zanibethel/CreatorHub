import { z } from "zod";

const number = z.number().finite().nullable();
const text = z.string().max(80);
const time = z.string().datetime().nullable();
export const paperAccountSchema = z.object({
  collectedAt: z.string().datetime(),
  account: z.object({ equity: z.number().finite(), cash: number, previousCloseEquity: number, currency: text }),
  positions: z.array(z.object({ symbol: text, side: text, quantity: number, entry: number, marketValue: number, unrealizedPl: number })).max(1000).nullable(),
  orders: z.array(z.object({ symbol: text, side: text, type: text, status: text, quantity: number, filled: number, limit: number, stop: number, submittedAt: time })).max(1000).nullable(),
  fills: z.array(z.object({ symbol: text, side: text, quantity: number, price: number, time })).max(10).nullable(),
  errors: z.record(z.string(), z.string().max(200)),
  ordersMayBeTruncated: z.boolean(),
});
export type PaperAccount = z.infer<typeof paperAccountSchema>;
export type AccountHistoryPoint = { time: string; equity: number };
export type AccountReport = {
  snapshot: PaperAccount | null;
  history: AccountHistoryPoint[];
  status: "pending" | "ready" | "setup_required" | "error";
  lastAttemptAt: string | null;
  nextSyncAt: string | null;
  message: string | null;
};
