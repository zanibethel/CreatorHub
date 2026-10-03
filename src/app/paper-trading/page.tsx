import type { Metadata } from "next";
import PaperTradingLab from "@/components/PaperTradingLab";

export const metadata: Metadata = {
  title: "$1,000 Paper Trading Report | CreatorHub",
  description: "Interactive paper portfolio report and near-live market watchlist.",
};

export default function PaperTradingPage() {
  return <PaperTradingLab />;
}
