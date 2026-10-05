import type { Metadata } from "next";
import PaperTradingLab from "@/components/PaperTradingLab";

export const metadata: Metadata = {
  title: "$1,000 Trading Report | CreatorHub",
  description: "$1,000 virtual trading fund with isolated bot pools, live market data, and strategy tracking.",
};

export default function PaperTradingPage() {
  return <PaperTradingLab />;
}
