# CreatorHub Platform Goals

## Core Mission

CreatorHub should help creators answer one question clearly: **What should I do next to grow, monetize, or operate my creator business?**

The platform should combine creator identity, AI-assisted production, digital products, promotion, affiliate distribution, commerce, analytics, and connected platforms in one operating system.

## Product Principles

Every major feature should do at least one of the following:

- Increase creator revenue.
- Reduce creator effort or support burden.
- Increase trust, clarity, or control.
- Help the creator decide what to do next.

CreatorHub should avoid becoming a pile of disconnected tools. Features should work together as a system.

## AI Strategy

Claude is the preferred primary intelligence layer for CreatorHub.

CreatorHub should use Claude for:

- Ebook ideation and market positioning.
- Outline generation.
- Long-form drafting and editing.
- Chapter and exercise generation.
- Product descriptions and sales copy.
- Creator-specific promotion material.
- Campaign planning.
- Audience/product matching.
- Content repurposing.
- Recommendations based on creator history and results.
- Store and marketplace assistance.

CreatorHub should keep the AI provider abstracted enough that individual tasks can later use other models where useful, but Claude should remain the primary writing/strategy engine unless there is a clear reason otherwise.

## Ebook and Digital Product System

Every creator should be able to do all of the following:

### Generate a new ebook

The creator selects topic, audience, tone, length, goal, and product direction. CreatorHub uses Claude to help create the outline, manuscript, exercises, sales copy, and promotion assets.

### Upload an existing ebook

The creator can upload an existing PDF or EPUB, create a product listing, price it, generate sales material, and sell it through their CreatorHub storefront.

### Import and improve a manuscript

The creator can upload source material such as Markdown, text, or document content and use Claude to restructure, edit, expand, polish, or repackage it.

### Generate derivative products

One structured book source should be reusable as:

- PDF ebook
- EPUB
- Workbook
- 7/14/30-day challenge
- Course
- Audio script
- Fanvue content
- TikTok/Reel scripts
- Instagram content
- Email sequences
- Quote cards
- Promotional hooks

A book should exist as structured content inside CreatorHub, not only as a PDF file.

## CreatorHub Original Library

CreatorHub should seed a range of marketable digital products that the platform owns.

Initial categories may include:

- Self-mastery
- Relationships
- Fatherhood and parenting
- Personal finance basics
- Productivity
- Fitness habits
- Confidence and communication
- Career development
- Creator growth
- Small-business basics

Creators should be able to browse these products, review audience fit and commission terms, and click **Add to My Store** or **Promote**.

The product remains linked to the CreatorHub-owned master product rather than being copied into separate unmanaged files.

CreatorHub should be able to recommend products automatically based on creator niche, audience, historical content, brand boundaries, engagement, and sales performance.

## Product Ownership Modes

CreatorHub should support at least three product classes:

### CreatorHub Originals

CreatorHub owns the intellectual property. Creators can promote the product for a commission. CreatorHub retains the product-owner share.

### Creator Marketplace Products

A creator or outside author owns the product and enables marketplace promotion. The product owner receives their share, promoting creators receive their commission, and CreatorHub receives a platform fee.

### Creator's Own Products

A creator generates or uploads a product for their own store. CreatorHub earns through subscriptions, AI usage, transaction/platform fees, and optional affiliate distribution.

## Distribution Modes

Products should support:

- **Private** — only the owner sells it.
- **Affiliate enabled** — approved creators may promote it.
- **Marketplace** — eligible creators can discover and add it to their stores.

## Creator Storefronts

Every creator should have a storefront where they can sell:

- Their own ebooks and digital products.
- CreatorHub Original products they choose to promote.
- Marketplace products they are approved to promote.
- External affiliate offers where appropriate.

Creators should be able to add a product to their store without manually building a new sales page.

Claude should generate creator-specific positioning and promotion material for the same master product.

## Affiliate and Attribution System

Every promotion relationship should support:

- Unique creator attribution.
- Click tracking.
- Conversion tracking.
- Commission percentage or fixed commission.
- Refund adjustments.
- Commission ledger.
- Creator earnings dashboard.
- Product-owner reporting.
- Platform revenue reporting.

A future URL pattern may resemble:

`/p/master-yourself-first?ref=<creator>`

Attribution should persist into checkout and purchase records.

## Commerce Strategy

Stripe should power direct product checkout and CreatorHub subscriptions.

Stripe Connect should be used when CreatorHub begins routing marketplace revenue to third-party creators or product owners.

CreatorHub should support platform-controlled fees and commission splits while keeping a clear ledger inside CreatorHub.

## Revenue Model

CreatorHub should intentionally stack multiple revenue sources:

### 1. Creator subscriptions
Recurring plan revenue for access to CreatorHub features.

### 2. AI usage / credits
Plans may include a monthly allowance. Higher-cost generation can consume credits or incur additional usage charges.

### 3. Platform transaction fees
CreatorHub earns a percentage or fee when creators sell their own or third-party products through the platform.

### 4. CreatorHub Original product sales
CreatorHub earns the product-owner share while promoters earn the configured creator commission.

### 5. Marketplace commissions
CreatorHub earns a platform fee when third-party product owners and promoting creators transact through the marketplace.

### 6. External affiliate revenue
CreatorHub and creators may promote relevant external affiliate products where appropriate.

### 7. Premium publishing and marketing services
Future paid services may include advanced publishing, campaign creation, storefront upgrades, analytics, managed promotion, and other creator-business services.

## AI-Powered Marketplace Recommendations

CreatorHub should proactively surface opportunities rather than requiring creators to manually search.

Example recommendation card:

- Product title
- Audience match score
- Retail price
- Creator commission
- Why it fits this creator
- Ready-to-post content count
- **Add & Promote** action

Claude should be able to generate promotional material using the creator's established persona, tone, audience, and platform strategy.

## Connected Platforms

CreatorHub should strive for one-click OAuth-style connections wherever supported.

Priority integrations include:

- Fanvue
- TikTok
- Instagram
- Facebook where useful
- YouTube
- X
- Stripe

Creators should not be required to repeatedly copy/paste authorization codes or manually manage credentials when normal OAuth flows are available.

## First End-to-End Validation

**Creator #1:** Ava, fictional adult AI creator.

**Seed Product #1:** Master Yourself First.

Initial validation loop:

Ava content -> CreatorHub tracked link -> CreatorHub product page -> Stripe checkout -> secure ebook delivery -> upsell/Fanvue follow-through -> analytics.

The first test should prove:

- Creator persona is reusable.
- Product can be sold and securely delivered.
- Promotion source can be attributed.
- Creator commission logic can be represented.
- Content can be generated from structured book material.
- Architecture can later support many creators promoting one master product.

## Near-Term Build Priority

1. Verify Claude production connectivity.
2. Verify Stripe production/test connectivity.
3. Complete secure ebook packaging and delivery.
4. Complete the first Ava purchase flow.
5. Add creator referral attribution to checkout.
6. Add product-library / marketplace data model.
7. Add **Add to My Store / Promote** workflow.
8. Add commission ledger.
9. Add CreatorHub subscription and AI-usage model.
10. Add Stripe Connect onboarding and marketplace payouts after the first-party purchase flow is proven.

## Long-Term Vision

CreatorHub becomes a creator-business operating system where a creator can connect their platforms, understand their audience, generate or source products, add those products to a storefront, receive AI-generated promotion plans, publish content, track sales and commissions, and continuously receive recommendations for the next best action.
