"use client";

import { useEffect, useState } from "react";
import type { PaperBotTradePlan } from "@/lib/paper-bot-trade-plan";

export type SqueezeBreakoutReadinessReport = {
  collectedAt:string;
  strategyId:string;
  strategyVersion:number;
  paperOnly:true;
  executionEnabled:boolean;
  opportunityZonePct:readonly [number,number] | [number,number];
  partialProfitPct:number;
  primaryTargetPct:number;
  plans:PaperBotTradePlan[];
};

export default function useSqueezeBreakoutReadiness(){
  const [report,setReport]=useState<SqueezeBreakoutReadinessReport|null>(null);
  const [error,setError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();
    let running=false;
    const refresh=async()=>{
      if(document.hidden || running || controller.signal.aborted) return;
      running=true;
      try{
        const response=await fetch("/api/paper-trading/bots/squeeze-breakout-readiness",{
          cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)]),
        });
        const body=await response.json();
        if(!response.ok) throw new Error(body.error || "Squeeze breakout readiness unavailable.");
        if(!controller.signal.aborted){setReport(body);setError("");}
      }catch(reason){
        if(!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Squeeze breakout readiness unavailable.");
      }finally{running=false;}
    };
    const visible=()=>{if(!document.hidden) void refresh();};
    void refresh();
    const timer=window.setInterval(()=>void refresh(),60_000);
    document.addEventListener("visibilitychange",visible);
    return ()=>{controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[]);

  return {report,error};
}
