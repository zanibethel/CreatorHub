import { NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

export async function POST(request: NextRequest) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) return Response.json({ error: "Stripe is not configured for CreatorHub yet." }, { status: 503 });

  const body = await request.json();
  const slug = String(body.slug ?? "").trim();
  if (!slug) return Response.json({ error: "Product is required." }, { status: 400 });

  const productResponse = await fetch(`${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=id,title,slug,description,price_cents,currency,product_type,file_path`, {
    headers: { apikey: SUPABASE_KEY },
    cache: "no-store",
  });
  if (!productResponse.ok) return Response.json({ error: "Could not load product." }, { status: 502 });
  const products = await productResponse.json();
  const product = products?.[0];
  if (!product || !product.price_cents || !product.file_path) return Response.json({ error: "This product is not ready for checkout." }, { status: 400 });

  const origin = new URL(request.url).origin;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${origin}/p/${product.slug}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/p/${product.slug}`);
  params.set("allow_promotion_codes", "true");
  params.set("billing_address_collection", "auto");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", product.currency || "usd");
  params.set("line_items[0][price_data][unit_amount]", String(product.price_cents));
  params.set("line_items[0][price_data][product_data][name]", product.title);
  if (product.description) params.set("line_items[0][price_data][product_data][description]", String(product.description).slice(0, 500));
  params.set("metadata[app]", "creatorhub");
  params.set("metadata[product_id]", product.id);
  params.set("metadata[product_slug]", product.slug);
  params.set("payment_intent_data[metadata][app]", "creatorhub");
  params.set("payment_intent_data[metadata][product_id]", product.id);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const session = await stripeResponse.json();
  if (!stripeResponse.ok || !session?.url) {
    console.error("Stripe checkout error", session);
    return Response.json({ error: session?.error?.message ?? "Could not start checkout." }, { status: 502 });
  }

  return Response.json({ url: session.url });
}
