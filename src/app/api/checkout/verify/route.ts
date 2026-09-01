import { NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

export async function GET(request: NextRequest) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!stripeSecret || !supabaseSecret) {
    return Response.json({ error: "Secure delivery is not configured yet." }, { status: 503 });
  }

  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!sessionId.startsWith("cs_")) return Response.json({ error: "Invalid checkout session." }, { status: 400 });

  const stripeResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeSecret}` },
    cache: "no-store",
  });
  const session = await stripeResponse.json();
  if (!stripeResponse.ok) return Response.json({ error: "Could not verify payment." }, { status: 502 });
  if (session.payment_status !== "paid") return Response.json({ error: "Payment has not completed." }, { status: 402 });

  const productId = session.metadata?.product_id;
  if (!productId) return Response.json({ error: "Checkout is missing product metadata." }, { status: 400 });

  const productResponse = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,title,slug,file_path`, {
    headers: { apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` },
    cache: "no-store",
  });
  const products = await productResponse.json();
  const product = products?.[0];
  if (!product?.file_path) return Response.json({ error: "The ebook file is unavailable." }, { status: 404 });

  const amountTotal = Number(session.amount_total ?? 0);
  const referralCode = String(session.metadata?.referral_code ?? "").trim() || null;
  const referringCreatorId = String(session.metadata?.referring_creator_id ?? "").trim() || null;
  const commissionBpsRaw = Number(session.metadata?.promoter_commission_bps ?? 0);
  const commissionBps = referralCode && referringCreatorId && Number.isFinite(commissionBpsRaw)
    ? Math.max(0, Math.min(10000, Math.round(commissionBpsRaw)))
    : null;
  const commissionCents = commissionBps === null ? null : Math.round((amountTotal * commissionBps) / 10000);

  const purchase = {
    product_id: product.id,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    buyer_email: session.customer_details?.email ?? session.customer_email ?? null,
    amount_total: amountTotal,
    currency: session.currency ?? "usd",
    payment_status: session.payment_status,
    referral_code: referralCode,
    referring_creator_id: referringCreatorId,
    promoter_commission_bps: commissionBps,
    promoter_commission_cents: commissionCents,
    fulfilled_at: new Date().toISOString(),
  };

  const purchaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/purchases?on_conflict=stripe_checkout_session_id`, {
    method: "POST",
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(purchase),
  });
  if (!purchaseResponse.ok) {
    console.error("Purchase record error", purchaseResponse.status, await purchaseResponse.text());
    return Response.json({ error: "Payment was verified, but the purchase record could not be saved." }, { status: 502 });
  }

  const signResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/creatorhub-products/${product.file_path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 900 }),
  });
  const signed = await signResponse.json();
  if (!signResponse.ok || !signed?.signedURL) return Response.json({ error: "Could not prepare the secure download." }, { status: 502 });

  const downloadUrl = signed.signedURL.startsWith("http") ? signed.signedURL : `${SUPABASE_URL}/storage/v1${signed.signedURL}`;
  return Response.json({ title: product.title, slug: product.slug, downloadUrl, expiresIn: 900 });
}
