# Affiliate & Commerce Partner Bank

## Status

**Planned resource bank — not yet integrated.**

This document preserves candidate affiliate, marketplace, API, and white-label partners that CreatorHub can eventually make available inside **Monetize**. The first detailed vertical is travel, but the same registry should later support ebooks, software, products, services, courses, and other commissionable offers.

Last research verification: **September 2, 2026**. Program terms, inventory, commissions, APIs, eligibility, and permitted traffic sources can change. Reverify every partner before applying or implementing.

Related future architecture: [Future Stream: Distributed Sales Network](./FUTURE_STREAM_SALES_NETWORK.md).

## Product Goal

A creator should not need to manage separate affiliate dashboards or decide which program is best alone.

CreatorHub should eventually let a creator:

1. Open **Monetize → Partner Bank**.
2. Browse approved programs and products.
3. See audience fit, expected commission type, restrictions, and supported content channels.
4. Add an offer to their storefront or campaign.
5. Ask CreatorHub AI, **“What should I promote today?”**
6. Generate approved scripts, captions, emails, landing pages, graphics, and tracked links.
7. Track clicks, bookings, cancellations, earned commission, CreatorHub’s share, and the creator’s payable balance in one place.

The intended commercial model is:

**Supplier fulfills the purchase → supplier pays gross partner commission → CreatorHub retains its disclosed platform share → creator receives the remaining creator share.**

## Critical Contract Rule

Do not assume that a normal affiliate account allows CreatorHub to recruit downstream creators or split commissions with them.

Before exposing any partner to CreatorHub users, obtain written confirmation that the applicable agreement permits the intended model, such as:

- sub-affiliate or publisher-network activity;
- multiple creators using CreatorHub-generated tracking identifiers;
- commission sharing or incentive payments;
- paid social, email, link-in-bio, storefront, and AI-assisted content;
- use of product data, prices, images, trademarks, and APIs;
- CreatorHub reporting program-level performance to participating creators.

If a standard affiliate agreement does not permit this, negotiate a direct platform, network, agency, reseller, or technology-partner agreement. A provider can remain in the research bank without becoming an enabled offer.

## Travel Partner Candidates

All entries below are **candidates**, not active CreatorHub integrations.

| Partner | Primary use | Initial integration path | Checkout / fulfillment | CreatorHub opportunity | Current status |
|---|---|---|---|---|---|
| **Travelpayouts** | Fast access to many travel affiliate programs | Partner links, widgets, feeds, and supported APIs | External travel brand | Aggregate programs quickly while CreatorHub adds its own creator-facing allocation and reporting layer | Research candidate |
| **Viator** | Tours, attractions, and experiences | Affiliate links/tools first; deeper commerce options later if approved | Viator | Straightforward experience inventory with performance commission | Research candidate |
| **RateHawk** | Accommodations and private/B2B rates | Affiliate relationship or direct API after approval and certification | Confirm contract model | Branded lodging inventory and potentially stronger rate/commission control | Research candidate |
| **Expedia Group** | Lodging, cars, and broader branded travel supply | Travel Redirect, White Label Travel Platform, or Rapid APIs after partner approval | Expedia/contract dependent | Progress from referral traffic to a branded end-to-end booking experience | Research candidate |
| **HBX Group / Hotelbeds** | Enterprise wholesale hotels and travel products | Direct B2B/API or white-label commercial relationship | Contract dependent | Large-scale inventory once CreatorHub has volume and travel operations maturity | Later-stage candidate |
| **Juniper Travel Technology** | Multi-product booking infrastructure, especially cruises | Booking engine and web-service/API commercial agreement | Contract dependent | Long-term unified booking layer for hotels, flights, transfers, activities, packages, and cruises | Later-stage candidate |
| **Beacon Travel** | Optional consumer membership affiliate offer | Direct affiliate/referral agreement only after contract review | Beacon / its suppliers | Could be listed as one offer in the bank, but should not define CreatorHub Travel | Optional candidate |

## Verified Research Notes

### Travelpayouts

Official resources:

- [Travelpayouts partnership platform](https://www.travelpayouts.com/en/)
- [Partner links API](https://support.travelpayouts.com/hc/en-us/articles/25289759198226-API-for-Travelpayouts-partner-links)
- [Brands with APIs and data feeds](https://support.travelpayouts.com/hc/en-us/articles/20384016664594-Brands-that-provide-access-to-APIs-and-data-feeds-for-Travelpayouts-partners)
- [Balance and payment API](https://support.travelpayouts.com/hc/en-us/articles/5169505760402-API-of-affiliates-balance-and-payment)

Current fit:

- Provides one account for multiple travel-brand affiliate programs.
- Supports centralized performance visibility and payouts.
- Offers a partner-links API that can convert eligible brand URLs into affiliate links.
- Some brands expose APIs or feeds; access and approval vary by brand.
- Useful for a fast MVP, but CreatorHub must verify whether Travelpayouts permits its downstream creator/network model.

Possible first implementation:

1. CreatorHub holds the approved platform relationship.
2. Admin imports enabled programs and their terms.
3. Each outbound click receives CreatorHub campaign, creator, offer, and sub-ID metadata where supported.
4. CreatorHub ingests conversion and payout data.
5. The internal commission ledger allocates the creator share only after a transaction is confirmed and outside relevant cancellation/refund risk.

### Viator

Official resource:

- [Viator Affiliate Program](https://partnerresources.viator.com/)

Current published program details include an affiliate commission on completed experiences and a post-click attribution window. Treat exact percentages and windows as configuration, not hard-coded product assumptions.

Current fit:

- Strong Phase 1 option for tours, attractions, excursions, and local experiences.
- Viator can remain the merchant/fulfillment layer while CreatorHub focuses on discovery, promotion, attribution, and creator earnings.
- Program rules must be reviewed for sub-affiliates, social traffic, brand usage, and use of inventory data inside CreatorHub.

### RateHawk

Official resources:

- [RateHawk API](https://www.ratehawk.com/lp/en-us/API/)
- [RateHawk partner information](https://www.ratehawk.com/)

Current published capabilities include broad accommodation inventory, hundreds of suppliers, direct API integration, affiliate cooperation, an API-key onboarding path, and production certification.

Current fit:

- Candidate for private/B2B hotel rates and deeper branded lodging search.
- More appropriate after CreatorHub can support rate freshness, cancellation terms, customer support handoff, reconciliation, and partner certification.
- Confirm whether CreatorHub will act as affiliate, travel technology platform, agency, or another contracted role.

### Expedia Group

Official resources:

- [Expedia Group Developer Hub](https://developers.expediagroup.com/)
- [Rapid API](https://developers.expediagroup.com/docs/rapid)
- [White Label Travel Platform](https://developers.expediagroup.com/white-label-travel-platform)
- [Rapid partner onboarding](https://developers.expediagroup.com/docs/products/rapid/setup/getting-started)

Current fit:

- **Travel Redirect** can support a lower-complexity referral path.
- **White Label Travel Platform** can provide a CreatorHub-branded portal.
- **Rapid API** can support a customized booking experience after approval, launch requirements, credentials, and certification work.
- Product availability and release status differ by travel category and may change, so capability flags must be partner/config driven.

### HBX Group / Hotelbeds

Official resource:

- [HBX Group B2B travel solutions](https://solutions.hbxgroup.com/b2b-travel/)

Current fit:

- Enterprise wholesale inventory and distribution candidate.
- Revisit when CreatorHub can demonstrate transaction volume, technical readiness, customer-support ownership, reconciliation, and compliance capacity.
- Do not prioritize over simpler external-checkout partners during the MVP.

### Juniper Travel Technology

Official resources:

- [Juniper Booking Engine](https://ejuniper.com/en/products/juniper-booking-engine/)
- [Juniper Web Services](https://ejuniper.com/en/products/juniper-booking-engine/modules/web-services/)
- [Juniper Cruises](https://ejuniper.com/en/products/juniper-booking-engine/modules/cruises/)
- [Juniper API documentation](https://api-edocs.ejuniper.com/)

Current fit:

- Strong later-stage candidate for a multi-product travel booking engine.
- Especially relevant to cruise inventory and workflows that basic affiliate networks may not cover well.
- Likely an enterprise commercial integration rather than a quick affiliate-program signup.

### Beacon Travel

Official resources to reverify before use:

- [Beacon Travel](https://beacon.travel/)
- [Beacon affiliate page](https://beacon.travel/affiliates)

Current fit:

- Potentially list as one optional membership/referral offer if its affiliate agreement permits CreatorHub’s model.
- Do not purchase a high-cost consumer membership as a prerequisite to validating CreatorHub Travel.
- Do not treat Beacon as the underlying wholesale infrastructure.
- Require written economics, renewal terms, cancellation rules, attribution, recurring-commission terms, approved claims, and fulfillment/support ownership before enabling it.

## Recommended Product Phases

### Phase 1 — External Checkout Affiliate Marketplace

Goal: validate creator demand and attribution with the lowest operational risk.

Start with programs that:

- keep checkout, payment, customer service, changes, cancellations, and refunds with the supplier;
- support deep links or trackable partner links;
- provide conversion and payout reporting;
- permit the channels CreatorHub creators will use;
- permit CreatorHub’s downstream creator/revenue-allocation model in writing.

Likely research order:

1. Travelpayouts platform/network agreement
2. Viator direct affiliate agreement
3. Beacon only as an optional offer after full contract review

Phase 1 CreatorHub features:

- partner and program registry;
- offer catalog;
- creator-specific tracked links/sub-IDs;
- campaign builder;
- required affiliate-disclosure insertion;
- click and conversion attribution;
- pending/approved/reversed commission states;
- creator/platform split ledger;
- admin reconciliation;
- creator earnings dashboard.

### Phase 2 — Branded Travel Storefront

Goal: keep discovery inside CreatorHub while a contracted supplier remains responsible for fulfillment or the transaction role defined in the agreement.

Candidates:

- RateHawk affiliate/API
- Expedia Travel Redirect
- Expedia White Label Travel Platform
- Expedia Rapid APIs

Additional capabilities required:

- destination and date search;
- live price and availability refresh;
- taxes/fees display;
- cancellation-policy display;
- accessible-travel filters where supplied;
- saved trips;
- price comparison rules that avoid unsupported savings claims;
- customer-support routing;
- booking-status synchronization;
- consent, privacy, and supplier terms acceptance.

### Phase 3 — CreatorHub Travel+

Potential subscription concept:

- private/member rates where contracts allow;
- AI trip planner;
- creator-curated deal collections;
- price-drop monitoring;
- rewards, credits, or cashback where legally and contractually permitted;
- recurring subscription share for the referring creator.

Do not build membership pricing around unverified wholesale savings. Validate real customer savings, retention, support cost, supplier restrictions, and applicable travel-club/seller-of-travel requirements first.

### Phase 4 — Multi-Supplier Travel Infrastructure

Candidates:

- HBX Group / Hotelbeds
- Juniper Travel Technology
- additional bedbanks, cruise systems, flight providers, insurance, eSIM, transfer, and rental partners

At this stage CreatorHub can choose suppliers per category, geography, rate quality, margin, support performance, cancellation terms, and audience fit instead of depending on one provider.

## Revenue and Commission Model

Store money as integer minor units and preserve the supplier’s original currency.

Illustrative calculation:

```text
gross_partner_commission
- network_or_processing_cost
- reserve_or_adjustment
= distributable_commission

distributable_commission × creator_share_rate = creator_earnings
distributable_commission - creator_earnings = creatorhub_revenue
```

The actual split must be configured per agreement and shown to creators before they activate an offer.

Never mark money payable from a click or unconfirmed booking. Suggested lifecycle:

```text
tracked → reported → pending → approved → payable → paid
                         ↘ reversed / partially_reversed
```

Support:

- one-time and recurring commissions;
- fixed and percentage payouts;
- tiered rates;
- new-customer bonuses;
- creator-specific negotiated rates;
- refunds, cancellations, no-shows, and chargeback clawbacks;
- partial reversals;
- multi-currency conversion with recorded source rate;
- payout holds/reserves;
- platform fees disclosed separately from supplier commission where appropriate.

## Proposed Data Model

### `partners`

- `id`
- `slug`
- `name`
- `category`
- `website_url`
- `application_url`
- `status`: research, applying, approved, paused, rejected, retired
- `relationship_type`: affiliate, network, platform, API, reseller, white_label
- `merchant_of_record`
- `fulfillment_owner`
- `support_owner`
- `subaffiliate_permission_status`
- `contract_effective_at`
- `contract_expires_at`
- `last_verified_at`
- `owner_user_id`
- `notes`

### `partner_programs`

- `id`
- `partner_id`
- `slug`
- `name`
- `vertical`
- `countries`
- `currencies`
- `allowed_channels`
- `prohibited_channels`
- `attribution_window`
- `commission_type`
- `commission_value`
- `recurring_rules`
- `validation_delay`
- `cancellation_rules`
- `minimum_payout`
- `required_disclosure`
- `terms_url`
- `status`

### `partner_offers`

- `id`
- `partner_program_id`
- `external_offer_id`
- `name`
- `description`
- `destination_or_market`
- `deeplink_template`
- `image_usage_status`
- `available_from`
- `available_until`
- `audience_tags`
- `accessibility_tags`
- `status`
- `last_synced_at`

### `creator_offer_activations`

- `id`
- `creator_id`
- `partner_offer_id`
- `tracking_code`
- `creator_share_bps`
- `activated_at`
- `terms_accepted_at`
- `status`

### `attribution_events`

- `id`
- `creator_id`
- `campaign_id`
- `partner_id`
- `partner_program_id`
- `partner_offer_id`
- `event_type`
- `internal_click_id`
- `partner_sub_id`
- `occurred_at`
- `metadata`

### `partner_conversions`

- `id`
- `partner_id`
- `external_conversion_id`
- `internal_click_id`
- `creator_id`
- `campaign_id`
- `booking_value_minor`
- `gross_commission_minor`
- `currency`
- `status`
- `booked_at`
- `completed_at`
- `validated_at`
- `raw_payload_reference`

### `commission_allocations`

- `id`
- `partner_conversion_id`
- `creator_amount_minor`
- `creatorhub_amount_minor`
- `reserve_amount_minor`
- `currency`
- `calculation_version`
- `status`
- `payable_at`
- `paid_at`

## Integration Architecture

Use adapters so product code is not coupled to one supplier:

```ts
interface CommercePartnerAdapter {
  createTrackedLink(input: TrackingInput): Promise<TrackedLink>;
  syncPrograms(): Promise<PartnerProgram[]>;
  syncOffers?(cursor?: string): Promise<OfferSyncResult>;
  importConversions(since: Date): Promise<PartnerConversion[]>;
  handleWebhook?(payload: unknown, signature?: string): Promise<PartnerEvent[]>;
  getBookingStatus?(externalId: string): Promise<BookingStatus>;
}
```

Each adapter should normalize provider-specific data into CreatorHub’s internal program, offer, attribution, conversion, and commission models.

Store secrets only in server-side environment variables or a secrets manager. The database should store credential references and non-secret connection metadata, never raw API secrets.

Suggested tracking parameters:

- CreatorHub creator ID
- campaign ID
- offer ID
- placement/channel
- content asset ID
- internal click ID

Use opaque public tracking tokens rather than exposing internal sequential IDs.

## AI Requirements

CreatorHub AI should rank eligible offers using:

- audience geography and demographics;
- creator niche and content history;
- allowed promotion channel;
- destination seasonality;
- conversion history;
- cancellation/reversal rate;
- expected creator earnings;
- customer value, not commission alone;
- disclosure and brand restrictions;
- accessibility and family-fit attributes where supplied.

AI output should include:

- why the offer fits;
- expected commission type, clearly qualified;
- required disclosure;
- prohibited claims;
- approved link;
- generated campaign assets;
- uncertainty when current price or availability is not live.

Never let the model invent rates, savings, inventory, commission percentages, availability, or supplier terms. These must come from current partner data.

## Trust, Compliance, and Operational Boundaries

MVP principle:

**CreatorHub is the technology, attribution, and marketing layer; the contracted travel supplier remains responsible for the purchase and fulfillment unless a later agreement explicitly changes that role.**

Before launch, obtain legal/compliance review covering at least:

- FTC endorsement and affiliate disclosures;
- earnings and savings claims;
- seller-of-travel and travel-club requirements by jurisdiction;
- use of private/member rates;
- consumer refunds and cancellation disclosures;
- privacy, profiling, cookies, and cross-border data;
- tax reporting and creator payouts;
- accessibility claims and filters;
- email/SMS consent;
- sanctions, prohibited destinations, and geographic restrictions;
- whether CreatorHub’s commission split creates a sub-agent, sub-affiliate, reseller, or other regulated relationship.

CreatorHub should never:

- hide the company actually selling or fulfilling the booking;
- advertise “wholesale” or guaranteed savings without contract permission and substantiation;
- show stale prices as current;
- pay creators before commissions are approved and reconciliation risk is understood;
- imply guaranteed creator earnings;
- permit creators to omit required affiliate disclosures;
- expose supplier credentials to creators or the browser.

## Partner Evaluation Checklist

Before moving a partner from **research** to **approved**, record:

- [ ] Written permission for CreatorHub’s downstream creator model
- [ ] Supported countries and creator eligibility
- [ ] Supported traffic sources and prohibited promotion methods
- [ ] API, feed, link, widget, white-label, and webhook capabilities
- [ ] Authentication method and credential owner
- [ ] Tracking/sub-ID limits and attribution window
- [ ] Commission schedule and recurring rules
- [ ] Booking validation, refund, cancellation, and clawback timing
- [ ] Payout threshold, currency, method, and tax documentation
- [ ] Merchant of record, fulfillment owner, and customer-support owner
- [ ] Trademark, image, copy, and price-display rules
- [ ] Required disclosures and prohibited claims
- [ ] Data retention and deletion requirements
- [ ] Rate limits, sandbox, certification, and launch review
- [ ] SLA/escalation path
- [ ] Contract termination and post-termination commission rules
- [ ] CreatorHub unit economics approved

## Near-Term Action Queue

These are business-development tasks, not current coding blockers:

1. Apply for or contact Travelpayouts and ask specifically about operating a managed creator/sub-affiliate network.
2. Apply for or contact Viator with the same downstream-creator questions.
3. Contact RateHawk about affiliate versus technology-platform/API contracts and required certification.
4. Apply to Expedia Group Partner Solutions and compare Redirect, White Label, and Rapid eligibility.
5. Keep HBX and Juniper as later-stage enterprise conversations.
6. Request Beacon’s complete affiliate agreement only if we want it listed as an optional membership offer.
7. Enter confirmed program details into the registry only after written approval; never seed guessed commission terms.
8. Build the generic partner registry and commission ledger before any provider-specific storefront.

## Definition of Ready for Coding

A partner is ready for implementation when CreatorHub has:

- an approved agreement;
- written confirmation of the downstream creator model;
- technical documentation and credentials or sandbox access;
- known tracking and conversion-import method;
- known fulfillment and support ownership;
- approved commission-split economics;
- recorded disclosure and channel restrictions;
- a test plan covering attribution, cancellation, reversal, and payout reconciliation.

Until then, preserve the partner as a research candidate in this bank.
