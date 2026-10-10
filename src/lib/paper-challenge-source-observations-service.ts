import {createAdminSupabaseClient} from "@/lib/supabase-admin";

export type SourceObservationSummary={
 challenge_id:string;bot_instance_id:string;display_name:string;
 legacy_source_bot_id:string|null;observation_count:number|string;
 recent_24h:number|string;candidate_count:number|string;rejected_count:number|string;
 scanner_assigned_count:number|string;legacy_qualified_count:number|string;
 distinct_symbols:number|string;latest_source_at:string|null;
};
const int=(v:string|number)=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):0;
export async function loadChallengeObservationSummaries(){
 const db=createAdminSupabaseClient();
 const {data,error}=await db.from("paper_challenge_source_observation_summary")
   .select("challenge_id,bot_instance_id,display_name,legacy_source_bot_id,observation_count,recent_24h,candidate_count,rejected_count,scanner_assigned_count,legacy_qualified_count,distinct_symbols,latest_source_at")
   .order("challenge_id").order("bot_instance_id").limit(2000);
 if(error||!data||data.length>=2000)throw Error("Source evidence comparison is incomplete.");
 return {version:"source-replay-v1",sourceOnly:true as const,paperOnly:true as const,
   brokerOrderAuthorized:false as const,simulatedPerformanceMeasured:false as const,
   generatedAt:new Date().toISOString(),
   instances:(data as SourceObservationSummary[]).map(x=>({
    challengeId:x.challenge_id,botInstanceId:x.bot_instance_id,
    legacyBotId:x.legacy_source_bot_id,displayName:x.display_name,
    totalObservations:int(x.observation_count),observations24h:int(x.recent_24h),
    sourceCandidateCount:int(x.candidate_count),sourceRejectedCount:int(x.rejected_count),
    sourceScannerAssignedCount:int(x.scanner_assigned_count),
    legacyQualifiedCount:int(x.legacy_qualified_count),
    distinctSourceSymbols:int(x.distinct_symbols),
    latestSourceAt:x.latest_source_at,
    challengeQualificationVerified:false as const,
    hypotheticalProfitLossUsd:null,
   })),
 };
}
export async function syncChallengeSourceObservations(challengeId:string,limit=8){
 if(!/^[a-z0-9][a-z0-9_-]{1,95}$/.test(challengeId)||
   !Number.isSafeInteger(limit)||limit<1||limit>15)
   throw Error("Invalid source observation scope.");
 const db=createAdminSupabaseClient();
 const {data,error}=await db.rpc("paper_challenge_sync_source_observations",{
   p_challenge_id:challengeId,p_limit_per_instance:limit,
 });
 if(error||!data)throw Error("Source journal observation projection rejected.");
 return data as unknown;
}
