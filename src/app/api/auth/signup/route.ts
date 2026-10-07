import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_DESTINATIONS = new Set(["/", "/upload", "/download"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const destination =
      typeof body?.destination === "string" && ALLOWED_DESTINATIONS.has(body.destination)
        ? body.destination
        : "/upload";

    if (!email || password.length < 6) {
      return NextResponse.json(
        { error: "Enter an email and a password with at least 6 characters." },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}${destination}` },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        session: Boolean(data.session),
        message: data.session
          ? "Account created."
          : "Account created. Check your email if confirmation is required, then sign in.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Sign up request was invalid." }, { status: 400 });
  }
}
