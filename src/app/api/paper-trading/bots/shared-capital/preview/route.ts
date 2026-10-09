import {NextResponse} from "next/server";
import {z} from "zod";
import {
  PAPER_SHARED_CAPITAL_POLICY_V1,
  previewSharedPaperAllocation,
  previewSharedPaperBatch,
} from "@/lib/paper-shared-capital-manager";

export const dynamic="force-dynamic";

const money=z.number().finite().nonnegative();
const exposure=z.object({
  symbol:z.string().min(1).max(32),
  sleeve:z.enum(["stocks","swing","crypto"]),
  concentrationGroup:z.string().min(1).max(80),
  marketValueUsd:money,
  plannedLossUsd:money,
}).strict();
const snapshot=z.object({
  equityUsd:z.number().finite().positive(),
  settledCashUsd:money,buyingPowerUsd:money,reservedCashUsd:money,
  dayStartEquityUsd:z.number().finite().positive(),
  weekStartEquityUsd:z.number().finite().positive(),
  dayProfitLossUsd:z.number().finite(),
  weekProfitLossUsd:z.number().finite(),
  holdings:z.array(exposure).max(200),
  pendingEntries:z.array(exposure).max(200),
}).strict();
const evidence=z.object({
  sampleSize:z.number().int().min(0),
  winners:z.number().int().min(0),
  averageWinR:z.number().finite().positive(),
  averageLossR:z.number().finite().positive(),
}).strict();
const candidate=z.object({
  botId:z.string().min(1).max(64),
  symbol:z.string().min(1).max(32),
  sleeve:z.enum(["stocks","swing","crypto"]),
  assetClass:z.enum(["stock","etf","crypto"]),
  concentrationGroup:z.string().min(1).max(80),
  entryPrice:z.number().finite().positive(),
  stopPrice:z.number().finite().positive(),
  targetPrice:z.number().finite().positive(),
  roundTripCostPct:z.number().finite().positive().max(10),
  strategyQualified:z.boolean(),freshQuote:z.boolean(),marketSessionEligible:z.boolean(),
  brokerProtectionSupported:z.boolean(),speculative:z.boolean(),
  meritEvidence:evidence.nullable().optional(),
}).strict();
const requestSchema=z.union([
  z.object({candidate,portfolio:snapshot}).strict(),
  z.object({candidates:z.array(candidate).min(1).max(50),portfolio:snapshot}).strict(),
]);

function respond(payload:unknown,status=200){
  return NextResponse.json(payload,{status,headers:{"Cache-Control":"no-store"}});
}
function authorized(request:Request){
  const token=process.env.CRON_SECRET?.trim()??"";
  return token.length>=32 && request.headers.get("authorization")===`Bearer ${token}`;
}

/** Preview only. This endpoint has no broker or database write privilege. */
export async function POST(request:Request){
  if (!authorized(request)) return respond({error:"Unauthorized."},401);
  let body:unknown;
  try {body=await request.json();}
  catch {return respond({error:"Invalid JSON request."},400);}
  const parsed=requestSchema.safeParse(body);
  if(!parsed.success)return respond({error:"Invalid portfolio/candidate inputs."},400);
  try{
    if("candidates" in parsed.data){
      const batch=previewSharedPaperBatch(parsed.data.candidates,parsed.data.portfolio);
      return respond({policy:PAPER_SHARED_CAPITAL_POLICY_V1,independentPreview:false,batch});
    }
    const preview=previewSharedPaperAllocation(parsed.data.candidate,parsed.data.portfolio);
    return respond({policy:PAPER_SHARED_CAPITAL_POLICY_V1,independentPreview:true,preview});
  }catch{
    return respond({error:"Allocation preview failed closed."},422);
  }
}
/** Explicitly labeled policy discovery for internal orchestration; no account mutations. */
export async function GET(request:Request){
  if (!authorized(request)) return respond({error:"Unauthorized."},401);
  return respond({policy:PAPER_SHARED_CAPITAL_POLICY_V1,
    independentPreview:true,executionIntegrated:false,
    existingBotLedgersUnchanged:true,capitalReservationsImplemented:false});
}
