// Pure, testable application-side limits. Only the server can reserve quota.
// Google's project limit is separate; these are deliberately conservative caps.
export type YouTubeQuotaBucket = "search.list" | "channels.list";

export type YouTubeQuotaLimits = {
  accountLimit: number;
  projectLimit: number;
  burstLimit: number;
};

export type YouTubeQuotaReservation = YouTubeQuotaLimits & {
  allowed: boolean;
  reason: "account_limit" | "project_limit" | "burst_limit" | null;
  bucket: YouTubeQuotaBucket;
  accountUsed: number;
  projectUsed: number;
  burstUsed: number;
  resetsAt: string;
  retryAt: string;
};

function cappedInt(value: string | undefined, fallback: number, maximum: number): number {
  if (!value || !/^[0-9]+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function youtubeQuotaLimits(
  bucket: YouTubeQuotaBucket,
  env: Record<string, string | undefined> = process.env,
): YouTubeQuotaLimits {
  if (bucket === "search.list") {
    return {
      accountLimit: cappedInt(env.CLIPPER_YOUTUBE_SEARCH_ACCOUNT_DAILY, 5, 10000),
      projectLimit: cappedInt(env.CLIPPER_YOUTUBE_SEARCH_PROJECT_DAILY, 90, 10000),
      burstLimit: cappedInt(env.CLIPPER_YOUTUBE_SEARCH_PER_MINUTE, 3, 100),
    };
  }
  return {
    accountLimit: cappedInt(env.CLIPPER_YOUTUBE_CHANNELS_ACCOUNT_DAILY, 50, 10000),
    projectLimit: cappedInt(env.CLIPPER_YOUTUBE_CHANNELS_PROJECT_DAILY, 9000, 10000),
    burstLimit: cappedInt(env.CLIPPER_YOUTUBE_CHANNELS_PER_MINUTE, 10, 100),
  };
}

export function quotaBucket(resource: "search" | "channels"): YouTubeQuotaBucket {
  return resource === "search" ? "search.list" : "channels.list";
}

export function pacificQuotaDay(instant: Date): string {
  // en-CA uses YYYY-MM-DD with the IANA timezone's actual DST rules.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

export function parseReservation(
  value: unknown,
  expectedBucket: YouTubeQuotaBucket,
): YouTubeQuotaReservation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.bucket !== expectedBucket || typeof row.allowed !== "boolean") return null;
  if (row.reason !== null && !["account_limit", "project_limit", "burst_limit"].includes(String(row.reason))) return null;
  for (const key of ["accountLimit", "projectLimit", "burstLimit", "accountUsed", "projectUsed", "burstUsed"]) {
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0) return null;
  }
  if (typeof row.resetsAt !== "string" || !Number.isFinite(Date.parse(row.resetsAt))) return null;
  if (typeof row.retryAt !== "string" || !Number.isFinite(Date.parse(row.retryAt))) return null;
  return row as YouTubeQuotaReservation;
}
