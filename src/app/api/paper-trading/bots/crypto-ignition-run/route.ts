import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic="force-dynamic";

const PUBLIC_ORIGIN=process.env.CREATORHUB_PUBLIC_ORIGIN||"https://creatorhub-gray.vercel.app";
const readinessSchema=z.object({
  paperOnly:z.literal(true),executionEnabled:z.boolean(),submissionReady:z.boolean(),
  selectedSymbol:z.string().nullable(),researchOnly:z.boolean(),candidates:z.array(z.object({
    symbol:z.string(),sourceScore:z.number(),state:z.enum(["ready","waiting","blocked"]),selectedForSubmission:z.boolean(),
  })),
});
function reply(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}

export async function GET(request:Request){
  const cronSecret=process.env.CRON_SECRET?.trim()??"";
  if(!cronSecret||request.headers.get("authorization")!==`Bearer ${cronSecret}`)return reply({error:"Unauthorized."},401);
  const token=process.env.PAPER_CRYPTO_IGNITION_EXECUTION_TOKEN?.trim()??"";
  if(token.length<32)return reply({error:"Spark execution token is not configured."},503);

  const readinessResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-readiness",PUBLIC_ORIGIN),{
    headers:{Authorization:`Bearer ${cronSecret}`},cache:"no-store",signal:AbortSignal.timeout(25_000),
  });
  if(!readinessResponse.ok)return reply({error:"Spark readiness check failed."},503);
  const readiness=readinessSchema.parse(await readinessResponse.json());

  if(readiness.executionEnabled){
    const manageResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-manage",PUBLIC_ORIGIN),{
      method:"POST",headers:{"x-paper-spark-execution-token":token},cache:"no-store",signal:AbortSignal.timeout(30_000),
    });
    const manage=await manageResponse.json().catch(()=>({error:"Spark manager returned invalid JSON."}));
    if(!manageResponse.ok)return reply({ok:false,action:"manager-error",result:manage},502);
    if(!["none","hold"].includes(manage.action??"none"))return reply({ok:true,action:"manage",result:manage});
  }

  if(!readiness.executionEnabled)return reply({ok:true,action:"none",reason:"spark-executor-disabled",researchOnly:true});
  if(!readiness.submissionReady||!readiness.selectedSymbol)return reply({ok:true,action:"none",reason:"no-selected-ready-spark-setup"});

  const executeResponse=await fetch(new URL("/api/paper-trading/bots/crypto-ignition-execute",PUBLIC_ORIGIN),{
    method:"POST",headers:{"Content-Type":"application/json","x-paper-spark-execution-token":token},
    body:JSON.stringify({symbol:readiness.selectedSymbol}),cache:"no-store",signal:AbortSignal.timeout(35_000),
  });
  const execution=await executeResponse.json().catch(()=>({error:"Spark executor returned invalid JSON."}));
  if(!executeResponse.ok){
    const expected=[409,423].includes(executeResponse.status);
    return reply({ok:expected,action:expected?"none":"execution-error",symbol:readiness.selectedSymbol,executorStatus:executeResponse.status,execution},expected?200:502);
  }
  return reply({ok:true,action:"execute",symbol:readiness.selectedSymbol,execution});
}
