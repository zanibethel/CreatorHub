type CronJobKey="pulse-run"|"pulse-manage"|"fuse-run"|"fuse-manage"|"atlas-run"|"harbor-run";
export type PaperCronInfo={job:CronJobKey;botId:string;expectedMinutes:1|5};

function safeAction(value:unknown,fallback:string):string{
  // Only an explicit short machine-readable action, never an error/reason
  // string. Arbitrary upstream errors can embed credentials or user data.
  if(typeof value!=="string"||!/^[a-z][a-z0-9-]{0,79}$/.test(value))
    return fallback;
  return value;
}
/**
 * Wrap an EXISTING CRON_SECRET-gated PAPER runner without touching strategy
 * selection, execution, response body, broker requests or position accounting.
 * Any heartbeat failure must not cause a rerun or duplicate broker action.
 */
export function withPaperCronHeartbeat(
  info:PaperCronInfo,
  run:(request:Request)=>Promise<Response>,
):(request:Request)=>Promise<Response>{
  return async request=>{
    const cron=process.env.CRON_SECRET?.trim()??"";
    // Do not record or access ledger for unauthorized callers.
    if(!cron||request.headers.get("authorization")!=="Bearer "+cron)
      return run(request);
    const start=Date.now();
    let response:Response;
    let thrown:unknown;
    try{
      response=await run(request);
    }catch(e){
      thrown=e;
      response=Response.json({ok:false,error:"PAPER cron execution failure."},{status:503});
    }
    // Attribution uses the scheduler's User-Agent in addition to CRON_SECRET.
    // UA is informational, not cryptographic attestation of Vercel origin.
    const source=(request.headers.get("user-agent")??"").startsWith("vercel-cron/")
      ?"vercel-cron-agent":"authenticated-other";
    let action=thrown?"runner-exception":response.ok?"completed":"failed";
    try {
      const obj=await response.clone().json() as Record<string,unknown>;
      action=safeAction(obj.action,action);
    } catch {}
    const secret=process.env.SUPABASE_SECRET_KEY?.trim()??"";
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()??"";
    if(secret&&url){
      try{
        const headers:Record<string,string>={apikey:secret,Accept:"application/json",
          "Content-Type":"application/json"};
        if(secret.startsWith("eyJ"))headers.Authorization="Bearer "+secret;
        const status=response.status;
        // Error text deliberately generic: no broker/API response content.
        const audit=await fetch(url+"/rest/v1/rpc/paper_bot_record_cron_health",{
          method:"POST",headers,cache:"no-store",
          body:JSON.stringify({
            p_job_key:info.job,p_bot_id:info.botId,
            p_expected_minutes:info.expectedMinutes,p_source:source,
            p_http_status:status,p_action:action,
            p_duration_ms:Math.min(300000,Math.max(0,Date.now()-start)),
            p_error:status>=400?"runner-http-"+status:null,
          }),signal:AbortSignal.timeout(4000),
        });
        if(!audit.ok)console.error("PAPER cron heartbeat unavailable:",info.job,audit.status);
      }catch{
        console.error("PAPER cron heartbeat write unavailable:",info.job);
      }
    }else{
      console.error("PAPER cron heartbeat configuration missing:",info.job);
    }
    // Never retry or translate a broker/strategy response due to telemetry.
    return response;
  };
}
