"use client";

import {useEffect,useState} from "react";
export type UpcomingStock={
  symbol:string;watchlistScore:number;watchlistStatus:string;
  assignedBotId:string;assignedBotName:string;reviewingBots:string[];
  planSource:"prepared-order"|"strategy-reference"|"awaiting-plan";
  planState:"prepared"|"watching"|"blocked"|"awaiting-plan";
  entryPrice:number|null;stopPrice:number|null;targetPrice:number|null;
  referenceNotional:number|null;netRewardRisk:number|null;
  allocatorState:"rejected"|"shadow-only"|"allocatable"|null;
  allocatorBudgetUsd:number|null;allocatorReasons:string[];
  paperOrderAuthorized:false;quoteFresh:boolean;quoteAt:string|null;
  planCheckedAt:string|null;reason:string;
};
export type UpcomingStockReport={
  collectedAt:string;executionMode:"observation-only";
  sharedPortfolio:{equityUsd:number;reservedCashUsd:number;executionIntegrated:false;lossWindowsVerified:false}|null;
  candidates:UpcomingStock[];modelNote:string;
};
export default function useUpcomingTrades(){
  const [report,setReport]=useState<UpcomingStockReport|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    let running=false;
    const refresh=async()=>{
      if(document.hidden||running||controller.signal.aborted)return;
      running=true;
      try{
        const response=await fetch("/api/paper-trading/bots/upcoming-trades",{
          cache:"no-store",
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]),
        });
        if(!response.ok)throw new Error("Upcoming trades are temporarily unavailable.");
        const result=await response.json() as UpcomingStockReport;
        if(!controller.signal.aborted){setReport(result);setError("");}
      }catch(e){
        if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Upcoming trades unavailable.");
      }finally{running=false;}
    };
    void refresh();
    const tick=window.setInterval(()=>void refresh(),60_000);
    const visible=()=>{if(!document.hidden)void refresh();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{controller.abort();window.clearInterval(tick);document.removeEventListener("visibilitychange",visible);};
  },[]);
  return {report,error};
}
