import type { Metadata } from "next";
import PaperBotLab from "@/components/PaperBotLab";

export const metadata: Metadata = {
  title: "Paper Bot Lab | CreatorHub",
  description: "Compare isolated paper-trading bot challenges and strategy styles.",
};

export default function PaperBotLabPage() {
  return <PaperBotLab />;
}
