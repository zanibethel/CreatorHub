import {NextResponse} from "next/server";
import {z} from "zod";
import {CHALLENGE_PROPOSAL_VERSION,CHALLENGE_SOURCE_ADAPTERS,
  normalizeChallengeTradeProposal,type ChallengeProposalInput} from "@/lib/paper-challenge-proposals";
import {normalizeChallengeProposalBatch} from "@/lib/paper-challenge-proposal-batch";

export const dynamic="force-dynamic";
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,
  headers:{"Cache-Control":"no-store","X-Paper-Execution":"disabled"}});
function authorized(req:Request){
  const token=process.env.CRON_SECRET?.trim()??"";
  return token.length>=32 && req.headers.get("authorization")===`Bearer ${token}`;
}
const identity=z.string().regex(/^[a-z0-9][a-z0-9_-]{1,95}$/);
const money=z.number().finite().nonnegative();
const participant=z.object({
  botInstanceId:identity,strategyId:identity,strategyVersion:z.number().int().positive(),
  legacyBotId:z.string().min(3).max(80),role:z.literal("trading"),
}).strict();
const contributor=z.object({
  contributorId:z.enum(["catalog","midas"]),role:z.literal("research"),
  canSubmitOrders:z.literal(false),
}).strict();
const challenge=z.object({
  challengeId:identity,startingCapitalUsd:money.positive(),equityUsd:money.positive(),
  settledCashUsd:money,reservedCashUsd:money,buyingPowerUsd:money,
  botInstances:z.array(participant).min(1).max(8),
  researchContributors:z.array(contributor).max(2),
  riskPolicyId:identity,brokerAccountRef:z.string().nullable(),
  mode:z.literal("shadow"),brokerIsolationVerified:z.literal(false),
}).strict();
const provenance=z.object({
  sourceRecordKey:identity,sourceObservedAt:z.string().min(10).max(64),
  quoteTimestamp:z.string().max(64).nullable(),quoteSource:z.string().max(100).nullable(),
  completedCandleTimestamp:z.string().max(64).nullable(),
  sourceEvidenceIds:z.array(z.string().max(120)).max(30),
  marketSessionEligible:z.boolean().nullable(),spreadPct:z.number().finite().nullable(),
  roundTripCostPct:z.number().finite().nullable(),
  concentrationGroup:z.string().max(100).nullable(),
  expiresAt:z.string().max(64).nullable(),
  researchEvidence:z.array(z.object({
    contributorId:z.enum(["catalog","midas"]),evidenceId:z.string().min(1).max(100),
    observedAt:z.string().min(10).max(64),
  }).strict()).max(12),
}).strict();
const submission=z.object({
  challenge,botInstanceId:identity,
  source:z.object({
    botId:z.string().min(3).max(80),
    adapter:z.enum(["atlas","fuse","harbor","flash","pulse","spark","orbit","coil"]),
  }).passthrough(),
  evidence:provenance,
  observedAt:z.string().min(10).max(64),
  currentSymbols:z.array(z.string().max(40)).max(200).nullable(),
  pendingSymbols:z.array(z.string().max(40)).max(200).nullable(),
  riskBreakersClear:z.boolean().nullable(),
  requestedMaximumRiskPct:z.number().finite().nullable().optional(),
  requestedMaximumPositionPct:z.number().finite().nullable().optional(),
  fractionalStockEligibilityVerified:z.boolean().optional(),
}).strict();
const bodySchema=z.union([
  z.object({input:submission}).strict(),
  z.object({inputs:z.array(submission).min(1).max(50)}).strict(),
]);
/** Authenticated internal metadata discovery. No strategy execution is invoked. */
export async function GET(request:Request){
  if(!authorized(request))return response({error:"Unauthorized."},401);
  return response({paperOnly:true,observationOnly:true,brokerOrderAuthorized:false,
    version:CHALLENGE_PROPOSAL_VERSION,sourceAdapters:CHALLENGE_SOURCE_ADAPTERS,
    liveSourceReevaluation:false,
    warning:"Supplied source evidence is not independently attested by this endpoint."});
}
/** Internal COMPUTATION ONLY. Caller supplies actual source evaluator outputs.
 * This does not read or write any DB, or contact any broker/strategy executor.
 */
export async function POST(request:Request){
  if(!authorized(request))return response({error:"Unauthorized."},401);
  let raw:string;
  try{raw=await request.text();}catch{return response({error:"Invalid body."},400);}
  if(raw.length>120_000)return response({error:"Payload exceeds audit limit."},413);
  let json:unknown;
  try{json=JSON.parse(raw);}catch{return response({error:"Invalid JSON."},400);}
  const parsed=bodySchema.safeParse(json);
  if(!parsed.success)return response({error:"Invalid shadow challenge proposal input."},400);
  try{
    const data=parsed.data;
    if("inputs" in data){
      const result=normalizeChallengeProposalBatch(data.inputs as ChallengeProposalInput[]);
      return response({...result,unverifiedCallerSuppliedEvidence:true});
    }
    const proposal=normalizeChallengeTradeProposal(data.input as ChallengeProposalInput);
    return response({paperOnly:true,brokerOrderAuthorized:false,
      unverifiedCallerSuppliedEvidence:true,proposal});
  }catch{
    return response({error:"Proposal normalization failed closed; no authorization issued."},422);
  }
}
