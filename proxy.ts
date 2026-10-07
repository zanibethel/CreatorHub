import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const FALLBACK_URL = "https://yufptpfiwdbzzrvhkvux.supabase.co";
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

function copyCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return response;

  const { data: access } = await supabase
    .from("creatorhub_account_access")
    .select("access_level")
    .eq("user_id", user.id)
    .maybeSingle();

  if (access?.access_level === "full") return response;

  const pathname = request.nextUrl.pathname;
  const allowedPage = pathname === "/upload" || pathname === "/download" || pathname === "/password";
  const allowedFileApi = pathname.startsWith("/api/files/");
  const allowedAuthApi =
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/signup" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/change-password";

  if (allowedPage || allowedFileApi || allowedAuthApi) return response;

  if (pathname.startsWith("/api/")) {
    return copyCookies(
      response,
      NextResponse.json({ error: "This account only has access to File Transfer." }, { status: 403 }),
    );
  }

  return copyCookies(response, NextResponse.redirect(new URL("/upload", request.url)));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
