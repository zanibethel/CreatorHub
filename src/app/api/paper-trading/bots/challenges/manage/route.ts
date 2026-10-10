import {NextResponse} from "next/server";
import {z} from "zod";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,
  headers:{"Cache-Control":"no-store","X-Paper-Execution":"disabled"}});
function authorized(req:Request){
  const secret=process.env.CRON_SECRET?.trim()??"";
  return secret.length>=32 && req.headers.get("authorization")===`Bearer ${secret}`;
}
const identifier=z.string().regex(/^[a-z0-9][a-z0-9_-]{1,95}$/);
const capital=z.number().finite().positive().max(1_000_000)
  .refine(x=>Math.abs(x*100-Math.round(x*100))<1e-7);
const sourceId=z.enum([
  "default-diverse","penny-volatility-day-100",
  "three-trade-weekly-swing-100","weekend-crypto-day-100",
  "momentum-breakout-100","crypto-ignition-100","crypto-swing-100",
  "squeeze-breakout-100",
]);
const bot=z.object({botInstanceId:identifier,legacyBotId:sourceId}).strict();
const bots=z.array(bot).min(1).max(16)
  .refine(items=>new Set(items.map(x=>x.botInstanceId)).size===items.length);
const research=z.array(z.enum(["catalog","midas"])).max(2)
  .refine(items=>new Set(items).size===items.length);
const create=z.object({
  action:z.literal("create"),challengeId:identifier,
  displayName:z.string().trim().min(1).max(120),
  startingCapitalUsd:capital,
  policyId:z.literal("shared-paper-capital-v1"),
  botInstances:bots,researchContributors:research,
}).strict();
const configure=z.object({
  action:z.literal("configure"),challengeId:identifier,
  expectedVersion:z.number().int().positive(),
  lifecycle:z.enum(["preview","paused","archived"]),
  botInstances:bots,researchContributors:research,
}).strict();
const fund=z.object({
  action:z.literal("fund"),challengeId:identifier,
  expectedVersion:z.number().int().positive(),
  eventKey:z.string().regex(/^[a-zA-Z0-9:_-]{2,160}$/),
  amountDeltaUsd:z.number().finite().refine(x=>x!==0&&Math.abs(x)<=1_000_000&&
    Math.abs(x*100-Math.round(x*100))<1e-7),
  reason:z.string().trim().min(4).max(500),
  evidence:z.record(z.string(),z.unknown()),
}).strict();
const schema=z.discriminatedUnion("action",[create,configure,fund]);
/**
 * Operator-only service-side mutation endpoint: all changes handled in
 * one Postgres transaction per SECURITY INVOKER RPC. No public user CRUD,
 * order routes, notifications, broker interaction or scenario resets.
 */
export async function POST(request:Request){
  if(!authorized(request))return reply({error:"Unauthorized."},401);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Admin storage unavailable."},503);
  let raw:string;
  try{raw=await request.text();}catch{return reply({error:"Unreadable request."},400);}
  if(raw.length>24_000)return reply({error:"Request exceeds limit."},413);
  let parsedJson:unknown;
  try{parsedJson=JSON.parse(raw);}catch{return reply({error:"Invalid JSON."},400);}
  const parsed=schema.safeParse(parsedJson);
  if(!parsed.success)return reply({error:"Invalid PAPER shadow challenge request."},400);
  const input=parsed.data;
  if(input.challengeId==="shared-paper-v1"||input.challengeId==="legacy-paper-100-v1")
    return reply({error:"Existing/legacy scenario management is not part of Step 4."},409);
  try{
    const db=createAdminSupabaseClient();
    let result;
    if(input.action==="create"){
      result=await db.rpc("paper_challenge_create_shadow",{
        p_id:input.challengeId,p_name:input.displayName,p_starting_usd:input.startingCapitalUsd,
        p_bots:input.botInstances.map(x=>({botInstanceId:x.botInstanceId,legacyBotId:x.legacyBotId})),
        p_research:input.researchContributors,p_policy_id:input.policyId,
      });
    }else if(input.action==="configure"){
      result=await db.rpc("paper_challenge_configure_shadow",{
        p_id:input.challengeId,p_expected_version:input.expectedVersion,
        p_lifecycle:input.lifecycle,
        p_bots:input.botInstances.map(x=>({botInstanceId:x.botInstanceId,legacyBotId:x.legacyBotId})),
        p_research:input.researchContributors,
      });
    }else{
      result=await db.rpc("paper_challenge_post_shadow_funding",{
        p_id:input.challengeId,p_expected_version:input.expectedVersion,
        p_event_key:input.eventKey,p_delta:input.amountDeltaUsd,
        p_reason:input.reason,p_evidence:input.evidence,
      });
    }
    if(result.error||!result.data)
      return reply({error:"Shadow challenge operation rejected; no success recorded."},409);
    return reply({paperOnly:true,brokerOrderAuthorized:false,
      operatorAuthenticated:true,result:result.data});
  }catch{
    return reply({error:"Shadow challenge operation could not be completed."},503);
  }
}
