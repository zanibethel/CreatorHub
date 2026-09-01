import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PAGE = { width: 432, height: 648, left: 48, right: 48, top: 52, bottom: 52 };
const CONTENT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-package-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeText(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
}

function wrapText(text: string, font: any, size: number, maxWidth: number) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildPdf(title: string, subtitle: string, markdown: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("CreatorHub");
  doc.setSubject("CreatorHub Original ebook");
  doc.setCreator("CreatorHub ebook packaging engine");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: rgb(0.055, 0.043, 0.08) });
  page.drawText("CREATORHUB ORIGINAL", { x: PAGE.left, y: 558, size: 11, font: bold, color: rgb(0.70, 0.53, 1) });
  const titleLines = wrapText(title.toUpperCase(), bold, 31, CONTENT_WIDTH);
  let coverY = 500;
  for (const line of titleLines) {
    page.drawText(line, { x: PAGE.left, y: coverY, size: 31, font: bold, color: rgb(1, 1, 1) });
    coverY -= 37;
  }
  coverY -= 12;
  for (const line of wrapText(subtitle, regular, 14, CONTENT_WIDTH)) {
    page.drawText(line, { x: PAGE.left, y: coverY, size: 14, font: regular, color: rgb(0.82, 0.80, 0.87) });
    coverY -= 21;
  }
  page.drawText("Strength is proven by what you can control in yourself.", { x: PAGE.left, y: 92, size: 11, font: italic, color: rgb(0.70, 0.53, 1) });

  let y = 0;
  let pageNumber = 0;
  const newBodyPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    pageNumber += 1;
    y = PAGE.height - PAGE.top;
    page.drawText(String(pageNumber), { x: PAGE.width / 2 - 4, y: 24, size: 8.5, font: regular, color: rgb(0.42, 0.42, 0.46) });
  };
  const ensureSpace = (height: number) => {
    if (y - height < PAGE.bottom) newBodyPage();
  };
  const drawWrapped = (text: string, options: { size?: number; font?: any; indent?: number; gapAfter?: number; lineHeight?: number; color?: any } = {}) => {
    const size = options.size ?? 10.8;
    const useFont = options.font ?? regular;
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.48;
    const lines = wrapText(text, useFont, size, CONTENT_WIDTH - indent);
    ensureSpace(lines.length * lineHeight + (options.gapAfter ?? 7));
    for (const line of lines) {
      page.drawText(line, { x: PAGE.left + indent, y, size, font: useFont, color: options.color ?? rgb(0.12, 0.12, 0.14) });
      y -= lineHeight;
    }
    y -= options.gapAfter ?? 7;
  };

  newBodyPage();
  const lines = markdown.replace(/\r/g, "").split("\n");
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) { y -= 4; continue; }
    if (trimmed === "---") { y -= 10; continue; }
    if (/^# Chapter\s+\d+/i.test(trimmed)) {
      if (y < PAGE.height - PAGE.top - 35) newBodyPage();
      drawWrapped(trimmed.replace(/^#\s*/, ""), { size: 11, font: bold, gapAfter: 5, color: rgb(0.40, 0.20, 0.68) });
      continue;
    }
    if (/^# /.test(trimmed)) {
      const heading = trimmed.replace(/^#\s+/, "");
      if (/MASTER YOURSELF FIRST/i.test(heading)) continue;
      ensureSpace(45);
      drawWrapped(heading, { size: 20, font: bold, lineHeight: 24, gapAfter: 12, color: rgb(0.09, 0.07, 0.12) });
      continue;
    }
    if (/^## /.test(trimmed)) {
      const heading = trimmed.replace(/^##\s+/, "");
      if (/^Chapters 2/i.test(heading)) continue;
      ensureSpace(38);
      drawWrapped(heading, { size: 15, font: bold, lineHeight: 19, gapAfter: 10, color: rgb(0.25, 0.12, 0.42) });
      continue;
    }
    if (/^### /.test(trimmed)) {
      drawWrapped(trimmed.replace(/^###\s+/, ""), { size: 12, font: bold, gapAfter: 7 });
      continue;
    }
    if (/^[-*] /.test(trimmed)) {
      drawWrapped(`- ${trimmed.replace(/^[-*]\s+/, "")}`, { size: 10.5, indent: 10, gapAfter: 4 });
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      drawWrapped(trimmed, { size: 10.5, indent: 8, gapAfter: 4 });
      continue;
    }
    const isCallout = /^\*\*.*\*\*$/.test(trimmed);
    drawWrapped(trimmed, { size: isCallout ? 11.3 : 10.8, font: isCallout ? bold : regular, gapAfter: isCallout ? 10 : 7 });
  }

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pageCount: doc.getPageCount() };
}

async function authorize(req: Request, product: any, jobToken: string | null) {
  const authorization = req.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    const { data } = await supabase.auth.getUser(authorization.slice(7));
    if (data.user?.id && data.user.id === product.owner_user_id) return { kind: "user", userId: data.user.id };
  }
  if (jobToken) {
    const tokenHash = await sha256(jobToken);
    const { data: job } = await supabase.from("product_packaging_jobs")
      .select("id,status,expires_at,used_at")
      .eq("product_id", product.id)
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (job && job.status === "pending" && !job.used_at && new Date(job.expires_at).getTime() > Date.now()) {
      await supabase.from("product_packaging_jobs").update({ status: "running", used_at: new Date().toISOString() }).eq("id", job.id);
      return { kind: "job", jobId: job.id };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  let auth: any = null;
  try {
    const body = await req.json();
    const productId = String(body.product_id || "");
    if (!productId) return Response.json({ error: "product_id is required" }, { status: 400, headers: corsHeaders });

    const { data: product } = await supabase.from("products")
      .select("id,title,slug,description,owner_user_id,status,metadata")
      .eq("id", productId)
      .maybeSingle();
    if (!product) return Response.json({ error: "Product not found" }, { status: 404, headers: corsHeaders });

    auth = await authorize(req, product, req.headers.get("x-package-token"));
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });

    const configuredUrls = Array.isArray(product.metadata?.packaging?.source_urls) ? product.metadata.packaging.source_urls : [];
    const sourceUrls = configuredUrls.length ? configuredUrls : (product.slug === "master-yourself-first" ? [
      "https://raw.githubusercontent.com/zanibethel/CreatorHub/main/docs/MASTER_YOURSELF_FIRST_MANUSCRIPT.md",
      "https://raw.githubusercontent.com/zanibethel/CreatorHub/main/docs/MASTER_YOURSELF_FIRST_CHAPTERS_02_12.md",
    ] : []);

    let markdown = typeof body.source_markdown === "string" ? body.source_markdown : "";
    if (!markdown && sourceUrls.length) {
      const parts: string[] = [];
      for (const url of sourceUrls) {
        const sourceResponse = await fetch(String(url), { headers: { "User-Agent": "CreatorHub-Packager/1.0" } });
        if (!sourceResponse.ok) throw new Error(`Could not load manuscript source (${sourceResponse.status}).`);
        parts.push(await sourceResponse.text());
      }
      markdown = parts.join("\n\n---\n\n");
    }
    if (!markdown.trim()) throw new Error("No manuscript source is configured for this product.");

    const subtitle = product.description || "Strength. Discipline. Respect. The standards that separate men who talk from men who lead.";
    const { bytes, pageCount } = await buildPdf(product.title, subtitle, markdown);
    const filePath = `${product.owner_user_id}/${product.id}/${product.slug}.pdf`;

    const { error: uploadError } = await supabase.storage.from("creatorhub-products").upload(filePath, bytes, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "3600",
    });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const nextMetadata = {
      ...(product.metadata || {}),
      packaging: {
        ...(product.metadata?.packaging || {}),
        source_urls: sourceUrls,
        format: "pdf",
        engine: "creatorhub-pdf-v1",
        page_count: pageCount,
        byte_size: bytes.length,
        packaged_at: new Date().toISOString(),
      },
    };
    const { error: updateError } = await supabase.from("products").update({ file_path: filePath, metadata: nextMetadata }).eq("id", product.id);
    if (updateError) throw new Error(`Product update failed: ${updateError.message}`);

    const { data: signed } = await supabase.storage.from("creatorhub-products").createSignedUrl(filePath, 900);
    if (auth.kind === "job") {
      await supabase.from("product_packaging_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        file_path: filePath,
        metadata: { page_count: pageCount, byte_size: bytes.length },
      }).eq("id", auth.jobId);
    }

    return Response.json({
      ok: true,
      product_id: product.id,
      status: product.status,
      file_path: filePath,
      page_count: pageCount,
      byte_size: bytes.length,
      verification_url: signed?.signedUrl || null,
      verification_expires_in: 900,
    }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    if (auth?.kind === "job") {
      await supabase.from("product_packaging_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown packaging error" }).eq("id", auth.jobId);
    }
    console.error("package-ebook error", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not package ebook" }, { status: 500, headers: corsHeaders });
  }
});
