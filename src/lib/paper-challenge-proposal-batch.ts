/**
 * Read-only challenge proposal aggregation. Never transmits orders or claims
 * capital. Distinct instance IDs do not prevent netting at a physical broker.
 */
import {normalizeChallengeTradeProposal,type ChallengeProposalInput} from "./paper-challenge-proposals";
const compact=(symbol:string)=>symbol.replace(/[\\/\s-]/g,"").toUpperCase();
export function normalizeChallengeProposalBatch(inputs:readonly ChallengeProposalInput[]){
  if(inputs.length>50)throw Error("Too many source observations.");
  const proposals=inputs.map(normalizeChallengeTradeProposal);
  const physicalKeys=new Map<string,number[]>();
  const decisionKeys=new Map<string,number[]>();
  for(let i=0;i<proposals.length;i++){
    const p=proposals[i];
    const symbolKey=p.challengeId+":"+compact(p.symbol);
    const physical=physicalKeys.get(symbolKey)??[];
    physical.push(i);physicalKeys.set(symbolKey,physical);
    const decisions=decisionKeys.get(p.decisionKey)??[];
    decisions.push(i);decisionKeys.set(p.decisionKey,decisions);
  }
  const block=(indices:number[],reason:string)=>{
    if(indices.length<2)return;
    for(const index of indices){
      const p=proposals[index];
      if(!p.blockers.includes(reason))p.blockers=[...p.blockers,reason];
      p.observationState="blocked";
    }
  };
  for(const group of physicalKeys.values())
    block(group,"Competing bot instances propose the same physical symbol in one challenge.");
  for(const group of decisionKeys.values())
    block(group,"Duplicate challenge/instance decision idempotency key.");
  return {paperOnly:true as const,brokerOrderAuthorized:false as const,
    executionReadyCount:0,proposals};
}
