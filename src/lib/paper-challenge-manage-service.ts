import {z} from "zod";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

/** Server-only mutation contract. Both operator bearer and session-owner API
 * call this shared, database-transaction-backed implementation.
 */
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
export const shadowManageSchema=z.discriminatedUnion("action",[create,configure,fund]);

export type ShadowManageInput=z.infer<typeof shadowManageSchema>;

export async function executeShadowManage(input:ShadowManageInput){
  if(input.challengeId==="shared-paper-v1"||input.challengeId==="legacy-paper-100-v1")
    throw new Error("The existing or legacy challenge is immutable in this workflow.");
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

  if(result.error||!result.data)throw new Error("Shadow challenge database operation rejected.");
  return result.data as unknown;
}
