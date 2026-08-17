import { createBrowserClient } from "@supabase/ssr";

const FALLBACK_URL = "https://yufptpfiwdbzzrvhkvux.supabase.co";
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY;
  return createBrowserClient(url, key);
}
