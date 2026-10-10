import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {syncChallengeSourceObservations} from "@/lib/paper-challenge-source-observations-service";
export const dynamic="force-dynamic";
export const maxDuration=60;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{
 "Cache-Control":"no-store","X-Paper-Execution":"disabled",
}});
/** Vercel Cron research projection; new challenge/instance identity is DB-authoritative.
 * No source evaluator rerun, broker call, invented fills or legacy ledger writes.
 */
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET?.trim()??"";
 if(secret.length<32||request.headers.get("authorization")!==`Bearer ${secret}`)
  return reply({error:"Unauthorized."},401);
 if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Storage unavailable."},503);
 const db=createAdminSupabaseClient();
 try{
  const {data,error}=await db.from("paper_challenges")
   .select("challenge_id").eq("lifecycle","preview")
   .eq("paper_only",true).eq("broker_execution_enabled",false)
   .order("challenge_id").limit(31);
  if(error||!data||data.length>=31)return reply({error:"Challenge scope incomplete."},503);
  const results:{challengeId:string;newObservations:number}[]=[];
  const failed:string[]=[];
  // Sequential bounded iteration prevents uncontrolled per-tenant fanout.
  for(const item of data){
   try{
    const result=await syncChallengeSourceObservations(item.challenge_id,8) as
      {newObservations?:number};
    results.push({challengeId:item.challenge_id,newObservations:
      Number(result.newObservations??0)});
   }catch{failed.push(item.challenge_id);}
  }
  return reply({paperOnly:true,brokerOrderAuthorized:false,
   sourceReplayOnly:true,challengeCount:results.length,
   newObservations:results.reduce((s,x)=>s+x.newObservations,0),
   results,failed},failed.length?503:200);
 }catch{return reply({error:"Source replay failed closed."},503);}
}
