import type { Metadata } from "next";
import PaperTradingLab from "@/components/PaperTradingLab";

export const metadata: Metadata = {
  title: "$1,000 PAPER Trading Report | CreatorHub",
  description: "$1,000 virtual PAPER fund with isolated bot pools, live market data, and strategy tracking.",
};

export default function PaperTradingPage() {
  return <PaperTradingLab />;
}
