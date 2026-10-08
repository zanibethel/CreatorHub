import Link from "next/link";
import styles from "./BotMascot.module.css";

// All artwork is a cropped atlas of the user-approved 3D mockup and whale character.
// Stored in CreatorHub's own public Supabase Storage bucket, not generated at runtime.
export const MASCOT_ART_URL = "https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/mascot-family.png";
// Individual user-approved 3D character portraits. Kept separate from the six-bot legacy atlas.
export const BOT_PORTRAIT_ART: Record<string, string> = {
  "default-diverse": "https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/atlas-approved-v2.png",
  "crypto-swing-100": "https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/orbit-approved-v2.png",
  "squeeze-breakout-100": "https://yufptpfiwdbzzrvhkvux.supabase.co/storage/v1/object/public/creatorhub-bot-art/coil-approved-v2.png",
};
const positions: Record<string, number> = {
  "penny-volatility-day-100": 0,
  "momentum-breakout-100": 1,
  "crypto-ignition-100": 2,
  "weekend-crypto-day-100": 3,
  "three-trade-weekly-swing-100": 4,
  midas: 5,
};
export const BOT_COLORS: Record<string, string> = {
  "default-diverse": "#40dbc0",
  "crypto-swing-100": "#b391ff",
  "squeeze-breakout-100": "#b8ef3a",
  "penny-volatility-day-100": "#ffad3e",
  "momentum-breakout-100": "#ff5bb7",
  "crypto-ignition-100": "#54d8ff",
  "weekend-crypto-day-100": "#ffcf4d",
  "three-trade-weekly-swing-100": "#49deeb",
  midas: "#43dcd9",
};
const names: Record<string,string> = {
  "default-diverse":"Atlas",
  "crypto-swing-100":"Orbit",
  "squeeze-breakout-100":"Coil",
  "penny-volatility-day-100":"Fuse",
  "momentum-breakout-100":"Pulse",
  "crypto-ignition-100":"Spark",
  "weekend-crypto-day-100":"Flash",
  "three-trade-weekly-swing-100":"Harbor",
  midas:"Midas",
};

export function BotMascot({botId,size="badge",className=""}:{botId:string;size?:"badge"|"switcher"|"gallery"|"profile";className?:string}){
 const idx=positions[botId];
 const name=names[botId]??botId;
 const color=BOT_COLORS[botId]??"#89a9c1";
 const portrait=BOT_PORTRAIT_ART[botId];
 if(portrait) return <span role="img" aria-label={`${name} trading bot mascot`} title={name} className={`${styles.art} ${styles[size]} ${styles.portrait} ${className}`} style={{backgroundImage:`url("${portrait}")`,"--bot-color":color} as React.CSSProperties}/>;
 if(idx===undefined) return <span role="img" aria-label={name} title={name} className={`${styles.art} ${styles[size]} ${styles.fallback} ${className}`} style={{"--bot-color":color} as React.CSSProperties}>{name.slice(0,1)}</span>;
 return <span role="img" aria-label={`${name} trading bot mascot`} title={name} className={`${styles.art} ${styles[size]} ${className}`} style={{backgroundImage:`url("${MASCOT_ART_URL}")`,backgroundSize:"600% 100%",backgroundPosition:`${idx*20}% center`,"--bot-color":color} as React.CSSProperties}/>;
}

export function BotBadge({botId,showName=true}:{botId:string;showName?:boolean}){
 const name=names[botId]??botId;
 const href=botId==="midas"?"/paper-trading/movers":`/paper-trading/bots/${encodeURIComponent(botId)}`;
 return <Link href={href} className={styles.badgeLink} title={`View ${name} details`}>
   <BotMascot botId={botId}/>
   {showName?<span>{name}</span>:null}
 </Link>;
}
