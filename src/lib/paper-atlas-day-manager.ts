export type AtlasDaySessionInput={
  marketOpen:boolean;
  nowMs:number;
  nextCloseMs:number|null;
};

export function atlasDaySession(input:AtlasDaySessionInput){
  const minutesToClose=input.nextCloseMs===null?null:(input.nextCloseMs-input.nowMs)/60_000;
  const flattenDue=input.marketOpen&&minutesToClose!==null&&minutesToClose<=30;
  const entriesOpen=input.marketOpen&&minutesToClose!==null&&minutesToClose>=60;
  return {marketOpen:input.marketOpen,minutesToClose,entriesOpen,flattenDue};
}

export type AtlasDayPositionInput={
  mark:number;
  averageEntry:number;
  initialStop:number;
  currentStop:number;
  partialCompleted:boolean;
  partialFraction:number;
};

const positive=(n:number)=>Number.isFinite(n)&&n>0;
export function atlasDayPositionAction(input:AtlasDayPositionInput){
  if(!positive(input.mark)||!positive(input.averageEntry)||!positive(input.initialStop)
     ||!positive(input.currentStop)||input.initialStop>=input.averageEntry)
    return {action:"invalid" as const,rMultiple:null,desiredStop:null,partialFraction:null};

  const risk=input.averageEntry-input.initialStop;
  const rMultiple=(input.mark-input.averageEntry)/risk;
  if(rMultiple>=1.75&&!input.partialCompleted){
    return {action:"partial-profit" as const,rMultiple,
      desiredStop:Math.max(input.currentStop,input.averageEntry),
      partialFraction:Math.min(1,Math.max(0,input.partialFraction))};
  }
  if(rMultiple>=1.75&&input.partialCompleted){
    return {action:"trail" as const,rMultiple,
      desiredStop:Math.max(input.currentStop,input.averageEntry,input.mark-risk),
      partialFraction:null};
  }
  if(rMultiple>=1){
    return {action:"break-even" as const,rMultiple,
      desiredStop:Math.max(input.currentStop,input.averageEntry),partialFraction:null};
  }
  return {action:"hold" as const,rMultiple,desiredStop:input.currentStop,partialFraction:null};
}
