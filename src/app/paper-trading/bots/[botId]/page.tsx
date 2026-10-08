import { notFound } from "next/navigation";
import { PAPER_BOT_PROFILES } from "@/lib/paper-bot-profiles";
import BotProfilePageClient from "@/components/BotProfilePageClient";

export function generateStaticParams(){
  return PAPER_BOT_PROFILES.map(profile=>({botId:profile.id}));
}

export default async function BotProfilePage({params}:{params:Promise<{botId:string}>}){
  const {botId}=await params;
  if(!PAPER_BOT_PROFILES.some(profile=>profile.id===botId))notFound();
  return <BotProfilePageClient botId={botId}/>;
}
