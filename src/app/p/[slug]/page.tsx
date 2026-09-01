import ProductBuyButton from "@/components/ProductBuyButton";
import { card, colors } from "@/lib/ui";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

type SalesCopy = {
  headline?: string;
  subheadline?: string;
  bullets?: string[];
  cta?: string;
};

function normalizeReferralCode(value?: string) {
  const ref = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(ref) ? ref : "";
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  const referralCode = normalizeReferralCode(ref);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=id,title,slug,description,price_cents,currency,cover_url,ai_sales_copy`, {
    headers: { apikey: SUPABASE_KEY },
    cache: "no-store",
  });
  const products = response.ok ? await response.json() : [];
  const product = products?.[0];

  if (!product) {
    return <main style={{ maxWidth: 760, margin: "0 auto", padding: 28 }}><section style={card}><h1>Product unavailable</h1><p style={{ color: colors.muted }}>This CreatorHub product is not currently published.</p></section></main>;
  }

  const copy = (product.ai_sales_copy || {}) as SalesCopy;
  const price = ((product.price_cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: (product.currency || "usd").toUpperCase() });

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "42px 24px 72px" }}>
      <div style={{ color: colors.purpleBright, fontWeight: 900, letterSpacing: ".02em", marginBottom: 20 }}>CreatorHub</div>
      <section style={{ ...card, padding: 28 }}>
        <div style={{ color: colors.purpleBright, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".1em" }}>Digital ebook</div>
        <h1 style={{ fontSize: "clamp(34px,7vw,60px)", lineHeight: 1.02, margin: "12px 0" }}>{copy.headline || product.title}</h1>
        <p style={{ fontSize: 20, color: colors.muted, lineHeight: 1.55 }}>{copy.subheadline || product.description}</p>
        {Array.isArray(copy.bullets) && copy.bullets.length > 0 && (
          <ul style={{ lineHeight: 1.8, paddingLeft: 22 }}>
            {copy.bullets.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
        <div style={{ marginTop: 26, display: "grid", gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 900 }}>{price}</div>
          <ProductBuyButton slug={product.slug} label={copy.cta || `Get ${product.title}`} referralCode={referralCode || undefined} />
          <div style={{ color: colors.muted, fontSize: 13 }}>Secure checkout powered by Stripe. Your ebook download is unlocked after successful payment.</div>
        </div>
      </section>
    </main>
  );
}
