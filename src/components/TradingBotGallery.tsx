import Link from "next/link";
import { PAPER_BOT_PROFILES } from "@/lib/paper-bot-profiles";
import { BotMascot,BOT_COLORS } from "./BotMascot";
import styles from "./TradingBotGallery.module.css";
const roster=["penny-volatility-day-100","momentum-breakout-100","crypto-ignition-100","weekend-crypto-day-100","three-trade-weekly-swing-100"];
function EquityLine({points,color}:{points:Array<{time:string;equity:number}>;color:string}){
 const data=points.filter(p=>Number.isFinite(p.equity)).slice(-28);
 if(data.length<2)return <span className={styles.noChart}>Equity history pending</span>;
 const lo=Math.min(...data.map(p=>p.equity));const hi=Math.max(...data.map(p=>p.equity));const range=Math.max(.01,hi-lo);
 const path=data.map((p,i)=>`${i?"L":"M"} ${(i/(data.length-1)*180).toFixed(1)} ${(39-(p.equity-lo)/range*33).toFixed(1)}`).join(" ");
 return <svg aria-label="Recorded virtual equity trend" className={styles.sparkline} viewBox="0 0 180 44" preserveAspectRatio="none" role="img"><path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}
export default function TradingBotGallery({history}:{history?:Record<string,Array<{time:string;equity:number}>>}){
 return <section className={styles.gallerySection} aria-label="Trading bot mascot cards">
   <div className={styles.header}><div><h2>Meet the trading bots</h2><p>Five specialists · one family · isolated $100 virtual portfolios</p></div><Link href="/paper-trading/movers" className={styles.midasLink}><BotMascot botId="midas" size="badge"/> Midas · Market Mover Intelligence →</Link></div>
   <div className={styles.grid}>{roster.map(id=>{
     const bot=PAPER_BOT_PROFILES.find(item=>item.id===id)!;
     const color=BOT_COLORS[id];
     return <Link key={id} href={`/paper-trading/bots/${id}`} className={styles.card} style={{"--bot-accent":color} as React.CSSProperties}>
       <BotMascot botId={id} size="gallery"/>
       <div className={styles.info}><strong>{bot.codename}</strong><span>{bot.role}</span><p>{bot.mission}</p><EquityLine points={history?.[id]??[]} color={color}/><small>{bot.executionState==="automatic"?"Simulated execution permitted":bot.executionState==="research"?"Research only":"Planned"} · View profile →</small></div>
     </Link>;
   })}</div>
 </section>;
}
