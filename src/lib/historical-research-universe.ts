import {DEFAULT_PAPER_WATCHLIST} from "./paper-watchlist";
import type {HistoryAssetClass} from "./historical-pattern-intelligence";

/** Research candidates. Not trading approvals. Delisted securities still require separate PIT coverage. */
const MORE_STOCKS=["TSLA","AMD","PLTR","SOFI","HOOD","COIN","MSTR","SMCI","GME","MARA","RIVN","OPCH","FNGR","SOUN","RKLB","ASTS"];
const MORE_CRYPTO=["ADA/USD","XRP/USD","DOGE/USD","LINK/USD","AVAX/USD","LTC/USD","BCH/USD","DOT/USD"];
export type ResearchAsset={assetClass:HistoryAssetClass;symbol:string;source:"watchlist"|"research"|"scanner"};
const normalize=(s:string)=>s.trim().toUpperCase().replace("-","/");
const valid=(x:ResearchAsset)=>x.assetClass==="stock"?/^[A-Z][A-Z0-9.]{0,9}$/.test(x.symbol):
  /^[A-Z0-9]{2,16}\/USD$/.test(x.symbol);

/** Stable default round-robin, augmented by relevant current scanner finds. */
export function historicalResearchUniverse(discoveries:Array<{asset_class:string;symbol:string}> = []):ResearchAsset[]{
  const assets:ResearchAsset[]=[
    ...DEFAULT_PAPER_WATCHLIST.stocks.map(x=>({assetClass:"stock" as const,symbol:normalize(x.symbol),source:"watchlist" as const})),
    ...DEFAULT_PAPER_WATCHLIST.crypto.map(x=>({assetClass:"crypto" as const,symbol:normalize(x.symbol),source:"watchlist" as const})),
    ...MORE_STOCKS.map(symbol=>({assetClass:"stock" as const,symbol,source:"research" as const})),
    ...MORE_CRYPTO.map(symbol=>({assetClass:"crypto" as const,symbol,source:"research" as const})),
    ...discoveries.slice(0,20).filter(x=>x.asset_class==="stock"||x.asset_class==="crypto")
      .map(x=>({assetClass:x.asset_class as HistoryAssetClass,symbol:normalize(x.symbol),source:"scanner" as const})),
  ];
  const uniq=new Map<string,ResearchAsset>();
  for(const x of assets)if(valid(x)&&!uniq.has(x.assetClass+":"+x.symbol))uniq.set(x.assetClass+":"+x.symbol,x);
  return [...uniq.values()];
}
/** Each 4-hour cron slot studies exactly ONE asset, avoiding high compute costs. */
export function scheduledResearchAsset(assets:ResearchAsset[],nowMs:number,slotHours=4){
  if(!assets.length)throw new Error("Research universe is empty.");
  const slot=Math.floor(nowMs/(slotHours*3600000));
  return assets[((slot%assets.length)+assets.length)%assets.length];
}
