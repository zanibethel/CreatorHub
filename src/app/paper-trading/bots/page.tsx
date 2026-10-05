import type { Metadata } from "next";
import PaperBotLab from "@/components/PaperBotLab";

export const metadata: Metadata = {
  title: "Bot Lab | CreatorHub",
  description: "Compare isolated virtual-trading bot challenges and strategy styles.",
};

export default function PaperBotLabPage() {
  return <PaperBotLab />;
}
