export type EbookCatalogStatus = "in_production" | "available" | "paused";

export type EbookCatalogItem = {
  slug: string;
  title: string;
  ownership: "CreatorHub Original" | "Creator Marketplace";
  status: EbookCatalogStatus;
  description: string;
  audience: string;
  priceCents: number;
  currency: "USD";
  promoterCommissionBps: number | null;
  commissionStatus: "proposed" | "approved";
  productPath: string;
};

export const ebookCatalog: readonly EbookCatalogItem[] = [
  {
    slug: "master-yourself-first",
    title: "Master Yourself First",
    ownership: "CreatorHub Original",
    status: "in_production",
    description: "A practical self-mastery guide about discipline, responsibility, earned respect, integrity, independent thinking, and leadership by example.",
    audience: "Adults interested in discipline, personal responsibility, family, confidence, and practical self-improvement",
    priceCents: 900,
    currency: "USD",
    promoterCommissionBps: 4000,
    commissionStatus: "proposed",
    productPath: "/p/master-yourself-first",
  },
] as const;

export function getAvailableEbooks() {
  return ebookCatalog.filter((ebook) => ebook.status === "available");
}
