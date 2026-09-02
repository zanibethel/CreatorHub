export type PartnerStatus = "research" | "applying" | "approved" | "paused";

export type PartnerCandidate = {
  slug: string;
  name: string;
  category: "Travel";
  phase: 1 | 2 | 3 | 4;
  status: PartnerStatus;
  primaryUse: string;
  integrationPath: string;
  opportunity: string;
  websiteUrl: string;
  requiresNetworkAgreement: boolean;
};

export const partnerCandidates: readonly PartnerCandidate[] = [
  {
    slug: "travelpayouts",
    name: "Travelpayouts",
    category: "Travel",
    phase: 1,
    status: "research",
    primaryUse: "Multiple travel affiliate programs from one network",
    integrationPath: "Tracked partner links, widgets, feeds, and approved APIs",
    opportunity: "Fastest path to testing a broad travel offer catalog",
    websiteUrl: "https://www.travelpayouts.com/en/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "viator",
    name: "Viator",
    category: "Travel",
    phase: 1,
    status: "research",
    primaryUse: "Tours, attractions, excursions, and local experiences",
    integrationPath: "Affiliate links and tools first; deeper commerce after approval",
    opportunity: "Creator-friendly experience inventory with supplier fulfillment",
    websiteUrl: "https://partnerresources.viator.com/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "ratehawk",
    name: "RateHawk",
    category: "Travel",
    phase: 2,
    status: "research",
    primaryUse: "Accommodation inventory and private or B2B rates",
    integrationPath: "Affiliate relationship or certified direct API",
    opportunity: "A branded lodging layer with greater rate and margin control",
    websiteUrl: "https://www.ratehawk.com/lp/en-us/API/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "expedia-group",
    name: "Expedia Group",
    category: "Travel",
    phase: 2,
    status: "research",
    primaryUse: "Lodging, cars, and broader branded travel supply",
    integrationPath: "Travel Redirect, White Label, or Rapid APIs",
    opportunity: "Progress from referrals to a branded booking experience",
    websiteUrl: "https://developers.expediagroup.com/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "hbx-hotelbeds",
    name: "HBX Group / Hotelbeds",
    category: "Travel",
    phase: 4,
    status: "research",
    primaryUse: "Enterprise wholesale hotels and travel products",
    integrationPath: "Direct B2B API or white-label commercial agreement",
    opportunity: "Large-scale inventory after CreatorHub proves volume and operations",
    websiteUrl: "https://solutions.hbxgroup.com/b2b-travel/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "juniper",
    name: "Juniper Travel Technology",
    category: "Travel",
    phase: 4,
    status: "research",
    primaryUse: "Multi-product infrastructure with strong cruise support",
    integrationPath: "Booking engine and web-service commercial agreement",
    opportunity: "A later unified layer for cruises and other travel categories",
    websiteUrl: "https://ejuniper.com/en/products/juniper-booking-engine/",
    requiresNetworkAgreement: true,
  },
  {
    slug: "beacon-travel",
    name: "Beacon Travel",
    category: "Travel",
    phase: 1,
    status: "research",
    primaryUse: "Optional consumer travel-membership referral offer",
    integrationPath: "Direct affiliate agreement after complete contract review",
    opportunity: "One optional offer in the bank, not CreatorHub's travel foundation",
    websiteUrl: "https://beacon.travel/affiliates",
    requiresNetworkAgreement: true,
  },
] as const;

export function getApprovedPartnerCandidates() {
  return partnerCandidates.filter((partner) => partner.status === "approved");
}
