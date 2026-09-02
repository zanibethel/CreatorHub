"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

type Product = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  status: "draft" | "published" | "archived";
  file_path: string | null;
  ai_sales_copy: Record<string, unknown>;
  metadata: {
    packaging?: {
      source_urls?: string[];
      format?: string;
      engine?: string;
      page_count?: number;
      byte_size?: number;
      packaged_at?: string;
    };
  } | null;
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function ProductManager({ userId, creatorId }: { userId: string; creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase.from("products")
      .select("id,title,slug,description,price_cents,currency,status,file_path,ai_sales_copy,metadata")
      .eq("creator_id", creatorId)
      .order("created_at", { ascending: false });
    if (error) return setMessage(error.message);
    setProducts((data ?? []) as Product[]);
  }, [creatorId, supabase]);

  useEffect(() => {
    void loadProducts();
    const refresh = () => { void loadProducts(); };
    window.addEventListener("creatorhub:products-changed", refresh);
    return () => window.removeEventListener("creatorhub:products-changed", refresh);
  }, [loadProducts]);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const price = Number(form.get("price") || 0);
    const file = form.get("file") as File | null;
    const slug = `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`;

    const { data: product, error } = await supabase.from("products").insert({
      creator_id: creatorId,
      owner_user_id: userId,
      product_type: "ebook",
      title,
      slug,
      description,
      price_cents: Math.round(price * 100),
      currency: "usd",
      status: "draft",
    }).select("id").single();

    if (error || !product) {
      setBusy(false);
      return setMessage(error?.message ?? "Could not create product.");
    }

    if (file && file.size > 0) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filePath = `${userId}/${product.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("creatorhub-products").upload(filePath, file, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });
      if (uploadError) {
        setBusy(false);
        setMessage(`Product created, but upload failed: ${uploadError.message}`);
        return loadProducts();
      }
      await supabase.from("products").update({ file_path: filePath }).eq("id", product.id);
    }

    formElement.reset();
    setBusy(false);
    setMessage("Ebook product created. Generate the sales copy, then publish it.");
    await loadProducts();
  }

  async function packageEbook(productId: string) {
    if (busy) return;
    setBusy(true);
    setMessage("CreatorHub is packaging the ebook PDF…");

    const { data, error } = await supabase.functions.invoke("package-ebook", {
      body: { product_id: productId },
    });

    setBusy(false);
    if (error) return setMessage(error.message || "CreatorHub could not package the ebook.");
    if (data?.error) return setMessage(data.error);

    const pages = Number(data?.page_count || 0);
    setMessage(pages ? `Ebook packaged successfully — ${pages} pages ready for secure delivery.` : "Ebook packaged successfully and is ready for secure delivery.");
    await loadProducts();
  }

  async function generateSalesCopy(productId: string) {
    setBusy(true);
    setMessage("Claude is building the sales page copy…");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/ai/product-sales-copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ productId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setBusy(false);
      return setMessage(result.error ?? "Claude could not generate sales copy.");
    }
    const { error } = await supabase.from("products").update({ ai_sales_copy: result }).eq("id", productId);
    setBusy(false);
    if (error) return setMessage(error.message);
    setMessage("Claude sales copy generated.");
    await loadProducts();
  }

  async function setStatus(productId: string, status: "draft" | "published") {
    const product = products.find((item) => item.id === productId);
    if (status === "published" && !product?.file_path) return setMessage("Package or upload the ebook file before publishing.");
    const { error } = await supabase.from("products").update({ status }).eq("id", productId);
    if (error) return setMessage(error.message);
    setMessage(status === "published" ? "Product published." : "Product returned to draft.");
    await loadProducts();
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Products</div>
      <h2 style={{ marginTop: 6 }}>Sell something</h2>
      <form onSubmit={createProduct} style={card}>
        <input name="title" required style={input} placeholder="Ebook title" />
        <textarea name="description" style={{ ...input, minHeight: 90 }} placeholder="What does the buyer get? A rough description is fine — Claude can improve it." />
        <input name="price" required type="number" min="0.5" step="0.01" style={input} placeholder="Price (USD)" />
        <input name="file" required type="file" accept="application/pdf,application/epub+zip,.pdf,.epub" style={input} />
        <button disabled={busy} style={{ ...primaryButton, marginTop: 8 }}>{busy ? "Working…" : "Create ebook product"}</button>
      </form>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {products.map((product) => {
          const copy = product.ai_sales_copy as { headline?: string; subheadline?: string };
          const packageInfo = product.metadata?.packaging;
          const canPackage = product.slug === "master-yourself-first" || Boolean(packageInfo?.source_urls?.length);
          return (
            <article key={product.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <strong style={{ fontSize: 18 }}>{product.title}</strong>
                  <div style={{ color: colors.muted, marginTop: 4 }}>${((product.price_cents ?? 0) / 100).toFixed(2)} · {product.status}</div>
                  {packageInfo?.page_count ? <div style={{ color: colors.muted, marginTop: 4, fontSize: 12 }}>{packageInfo.page_count} page PDF · {packageInfo.engine || "CreatorHub packager"}</div> : null}
                </div>
                <span style={{ color: product.file_path ? colors.purpleBright : colors.muted }}>{product.file_path ? "File ready" : "No file"}</span>
              </div>
              {copy.headline && <p style={{ marginBottom: 4 }}><strong>{copy.headline}</strong></p>}
              {copy.subheadline && <p style={{ color: colors.muted, marginTop: 0 }}>{copy.subheadline}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {canPackage && <button type="button" disabled={busy} style={secondaryButton} onClick={() => packageEbook(product.id)}>{product.file_path ? "Repackage PDF" : "Package PDF"}</button>}
                <button type="button" disabled={busy} style={secondaryButton} onClick={() => generateSalesCopy(product.id)}>Generate with Claude</button>
                <button type="button" disabled={busy} style={primaryButton} onClick={() => setStatus(product.id, product.status === "published" ? "draft" : "published")}>
                  {product.status === "published" ? "Unpublish" : "Publish"}
                </button>
                {product.status === "published" && <a style={{ ...secondaryButton, textDecoration: "none" }} href={`/p/${product.slug}`} target="_blank">Open sales page</a>}
              </div>
            </article>
          );
        })}
      </div>
      {message && <p style={{ color: colors.muted }}>{message}</p>}
    </section>
  );
}
