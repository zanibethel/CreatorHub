import type { Metadata } from "next";
import PaperBotLab from "@/components/PaperBotLab";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bot Lab | CreatorHub",
  description: "Compare isolated virtual-trading bot challenges and strategy styles.",
};

export default function PaperBotLabPage() {
  return <><nav style={{padding:"14px 5%",background:"#102437",borderBottom:"1px solid #2a576c"}}>
    <Link href="/paper-trading/bots/challenges"
      style={{color:"#a1f2ff",fontWeight:750,textDecoration:"none",fontSize:14}}>
      ↗ Open owner Challenge Manager
    </Link>
  </nav><PaperBotLab /></>;
}
