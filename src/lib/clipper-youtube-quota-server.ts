import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { YouTubeDiscoveryError } from "@/lib/youtube-discovery";
import {
  parseReservation, quotaBucket, youtubeQuotaLimits,
  type YouTubeQuotaBucket, type YouTubeQuotaReservation,
} from "@/lib/clipper-youtube-quota";

export class YouTubeQuotaError extends YouTubeDiscoveryError {
  constructor(
    message: string,
    status: number,
    public readonly quota?: YouTubeQuotaReservation,
  ) {
    super(message, status);
  }
}

export async function reserveYouTubeApiCall(
  userId: string,
  resource: "search" | "channels",
): Promise<YouTubeQuotaReservation> {
  const bucket = quotaBucket(resource);
  const limits = youtubeQuotaLimits(bucket);
  let data: unknown;
  let error: { message?: string } | null = null;
  try {
    const result = await createAdminSupabaseClient().rpc("clipper_youtube_reserve_quota", {
      p_user_id: userId,
      p_bucket: bucket,
      p_account_limit: limits.accountLimit,
      p_project_limit: limits.projectLimit,
      p_burst_limit: limits.burstLimit,
    });
    data = result.data;
    error = result.error;
  } catch {
    throw new YouTubeQuotaError("YouTube quota service is unavailable. Please try again later.", 503);
  }
  if (error) {
    // Fail closed. Never send an unmetered upstream API request.
    console.error("clipper_youtube_reserve_quota error:", error.message);
    throw new YouTubeQuotaError("YouTube quota service is unavailable. Please try again later.", 503);
  }

  const receipt = parseReservation(data, bucket);
  if (!receipt) throw new YouTubeQuotaError("YouTube quota service returned an invalid response.", 503);
  if (!receipt.allowed) {
    const reasons = {
      account_limit: "Your YouTube request allowance is used up.",
      project_limit: "CreatorHub's shared YouTube API allowance is used up.",
      burst_limit: "Too many YouTube requests in a short time.",
    };
    throw new YouTubeQuotaError(
      reasons[receipt.reason ?? "project_limit"] + " Please try after the indicated reset.",
      429,
      receipt,
    );
  }
  return receipt;
}

export function quotaPublicFields(quota: YouTubeQuotaReservation) {
  // Does not reveal other CreatorHub users, credentials, or raw ledger rows.
  return {
    bucket: quota.bucket,
    reason: quota.reason,
    accountUsed: quota.accountUsed,
    accountLimit: quota.accountLimit,
    projectUsed: quota.projectUsed,
    projectLimit: quota.projectLimit,
    resetsAt: quota.resetsAt,
    retryAt: quota.retryAt,
  };
}

export async function ownYouTubeQuotaStatus(userId: string, bucket: YouTubeQuotaBucket) {
  const limits = youtubeQuotaLimits(bucket);
  const client = createAdminSupabaseClient();
  const today = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(today);
  const get = (name: string) => dateParts.find((part) => part.type === name)?.value ?? "";
  const day = [get("year"), get("month"), get("day")].join("-");
  const [account, project] = await Promise.all([
    client.from("clipper_youtube_account_quota").select("used")
      .eq("user_id", userId).eq("period_day", day).eq("bucket", bucket).maybeSingle(),
    client.from("clipper_youtube_project_quota").select("used")
      .eq("period_day", day).eq("bucket", bucket).maybeSingle(),
  ]);
  if (account.error || project.error) throw new YouTubeQuotaError("YouTube quota status is unavailable.", 503);
  return {
    bucket,
    accountUsed: account.data?.used ?? 0,
    accountLimit: limits.accountLimit,
    projectUsed: project.data?.used ?? 0,
    projectLimit: limits.projectLimit,
    // Reset time supplied by server on next reservation; status gives the
    // Pacific quota date to avoid exposing potentially misleading UTC dates.
    pacificDate: day,
  };
}
