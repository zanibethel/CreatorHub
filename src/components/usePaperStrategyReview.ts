"use client";

import { useEffect, useState } from "react";

export type PaperStrategyReviewRecommendation = {
  id:string;
  severity:"info"|"review";
  title:string;
  rationale:string;
  evidenceCount:number;
  advisoryOnly:true;
  requiresNewStrategyVersion:true;
  paperValidationRequired:true;
};

export type PaperStrategyReviewBot = {
  botId:string;
  displayName:string;
  strategyId:string|null;
  strategyVersion:number|null;
  status:string;
  evidenceMaturity:{
    level:"collecting"|"early"|"developing"|"established";
    minimumForRecommendations:number;
    resolvedOutcomeSamples:number;
  };
  executed:{
    openTrades:number;
    closedTrades:number;
    closedTradesWithR:number;
    averageR:number|null;
    winRatePct:number|null;
    totalRealizedPl:number;
    totalEstimatedFees:number;
    averageMfeR:number|null;
    averageMaeR:number|null;
  };
  counterfactual:{
    total:number;
    active:number;
    terminal:number;
    analyzable:number;
    missedOpportunities:number;
    protectiveRejections:number;
    mixed:number;
    neverTriggered:number;
    ambiguous:number;
    averageMfeR:number|null;
    averageMaeR:number|null;
  };
  decisions:{
    observations:number;
    executionRelevantObservations:number;
    monitorOnlyObservations:number;
    candidateEvents:number;
    authorizedEvents:number;
    strategyRejectedEvents:number;
    brokerRejectedEvents:number;
    canceledEvents:number;
    expiredEvents:number;
    replacedEvents:number;
    executionErrors:number;
    topReasons:Array<{reason:string;count:number}>;
  };
  scoreBands:Array<{
    band:string;
    observations:number;
    averageObservedScore:number|null;
    resolvedStudies:number;
    missedOpportunityRatePct:number|null;
    protectiveRejectionRatePct:number|null;
  }>;
  symbols:Array<{
    symbol:string;
    observations:number;
    averageScore:number|null;
    maxScore:number|null;
    closedTrades:number;
    averageExecutedR:number|null;
    resolvedCounterfactuals:number;
    missedOpportunities:number;
    protectiveRejections:number;
  }>;
  recommendations:PaperStrategyReviewRecommendation[];
};

export type PaperStrategyReviewReport = {
  collectedAt:string;
  policy:{
    advisoryOnly:true;
    automaticStrategyMutation:false;
    automaticRiskIncrease:false;
    liveMoneyChangesAllowed:false;
    minimumResolvedOutcomesForRecommendations:number;
    materialChangesRequireNewStrategyVersion:true;
    paperValidationRequired:true;
    counterfactualsAreNotPnL:true;
  };
  bots:PaperStrategyReviewBot[];
};

export default function usePaperStrategyReview() {
  const [report,setReport]=useState<PaperStrategyReviewReport|null>(null);
  const [error,setError]=useState("");
  const [refreshVersion,setRefreshVersion]=useState(0);

  useEffect(()=>{
    const controller=new AbortController();
    let running=false;

    const refresh=async()=>{
      if(document.hidden||running||controller.signal.aborted)return;
      running=true;
      try{
        const response=await fetch("/api/paper-trading/bots/strategy-review",{
          cache:"no-store",
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]),
        });
        const body=await response.json();
        if(!response.ok)throw new Error(body.error||"Strategy review unavailable.");
        if(!controller.signal.aborted){
          setReport(body);
          setError("");
        }
      }catch(reason){
        if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Strategy review unavailable.");
      }finally{
        running=false;
      }
    };

    const visible=()=>{if(!document.hidden)void refresh();};
    void refresh();
    const timer=window.setInterval(()=>{void refresh();},30_000);
    document.addEventListener("visibilitychange",visible);
    return()=>{
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",visible);
    };
  },[refreshVersion]);

  return {report,error,refresh:()=>setRefreshVersion(value=>value+1)};
}
