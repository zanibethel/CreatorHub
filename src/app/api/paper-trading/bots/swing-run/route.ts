import {withPaperCronHeartbeat} from "@/lib/paper-cron-health";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";

const readinessSchema=z.object({
  collectedAt:z.string(),
  paperOnly:z.literal(true),
  executionEnabled:z.boolean(),
  submissionReady:z.boolean(),
  plans:z.array(z.object({
    symbol:z.string(),
    state:z.enum(["ready","waiting","blocked"]),
    selectedForSubmission:z.boolean(),
  })),
});

function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}

async function runPaperCron(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim()??"";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`){
    return reply({error:"Unauthorized."},401);
  }

  const executionToken=process.env.PAPER_SWING_EXECUTION_TOKEN?.trim()??"";
  if(executionToken.length<32){
    return reply({error:"Swing execution token is not configured."},503);
  }

  let intakeResult:unknown={ok:false,action:"not-run"};
  try{
    const intakeResponse=await fetch(
      new URL("/api/paper-trading/bots/swing-prospect-intake",PUBLIC_ORIGIN),
      {
        headers:{Authorization:`Bearer ${cronSecret}`},
        cache:"no-store",
        signal:AbortSignal.timeout(30_000),
      },
    );
    intakeResult=await intakeResponse.json().catch(()=>({error:"Prospect intake returned an invalid response."}));
    if(!intakeResponse.ok){
      return reply({
        ok:false,
        action:"intake-error",
        intakeStatus:intakeResponse.status,
        intake:intakeResult,
      },502);
    }
  }catch(error){
    return reply({
      ok:false,
      action:"intake-error",
      error:error instanceof Error?error.message:"Swing prospect intake failed.",
    },502);
  }

  const readinessResponse=await fetch(
    new URL("/api/paper-trading/bots/swing-readiness",PUBLIC_ORIGIN),
    {
      headers:{Authorization:`Bearer ${cronSecret}`},
      cache:"no-store",
      signal:AbortSignal.timeout(30_000),
    },
  );
  const readinessBody=await readinessResponse.json().catch(()=>({error:"Swing readiness returned an invalid response."}));
  if(!readinessResponse.ok){
    return reply({
      ok:false,
      action:"readiness-error",
      readinessStatus:readinessResponse.status,
      readiness:readinessBody,
      intake:intakeResult,
    },502);
  }

  const readiness=readinessSchema.parse(readinessBody);
  if(!readiness.executionEnabled){
    return reply({
      ok:true,
      action:"none",
      reason:"swing-executor-disabled",
      intake:intakeResult,
      collectedAt:readiness.collectedAt,
    });
  }

  const selected=readiness.plans.find(plan=>plan.selectedForSubmission&&plan.state==="ready");
  if(!readiness.submissionReady||!selected){
    return reply({
      ok:true,
      action:"none",
      reason:"no-selected-ready-setup",
      intake:intakeResult,
      collectedAt:readiness.collectedAt,
      readySymbols:readiness.plans.filter(plan=>plan.state==="ready").map(plan=>plan.symbol),
    });
  }

  const executeResponse=await fetch(
    new URL("/api/paper-trading/bots/swing-execute",PUBLIC_ORIGIN),
    {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-paper-swing-execution-token":executionToken,
      },
      body:JSON.stringify({symbol:selected.symbol}),
      cache:"no-store",
      signal:AbortSignal.timeout(30_000),
    },
  );
  const execution=await executeResponse.json().catch(()=>({error:"Swing executor returned an invalid response."}));

  if(!executeResponse.ok){
    const expectedRace=[409,423].includes(executeResponse.status);
    return reply({
      ok:expectedRace,
      action:expectedRace?"none":"execution-error",
      reason:expectedRace?"setup-changed-during-final-revalidation":"swing-execution-failed",
      symbol:selected.symbol,
      executorStatus:executeResponse.status,
      execution,
      intake:intakeResult,
    },expectedRace?200:502);
  }

  return reply({
    ok:true,
    action:"execute",
    symbol:selected.symbol,
    execution,
    intake:intakeResult,
    note:"Only one new swing submission is attempted per five-minute cycle.",
  });
}

export const GET=withPaperCronHeartbeat({job:"harbor-run",botId:"three-trade-weekly-swing-100",expectedMinutes:5},runPaperCron);
