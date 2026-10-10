import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";
import {buildPaperEightBotAudit,type AuditLedger,type AuditPerformance,
  type AuditCron,type AuditDbPosition,type AuditDbOrder,
  type AuditBrokerOrder,type AuditBrokerPosition} from "@/lib/paper-execution-audit";

export const dynamic="force-dynamic";
// Privileged, read-only on-demand collector. NO execution-route imports.
// This URL must never be exposed in public Bot Lab fetches.
function reply(body:unknown,status=200){
  return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
}
function authorized(request:Request){
  const secret=process.env.CRON_SECRET?.trim()??"";
  return secret.length>=32 && request.headers.get("authorization")===`Bearer ${secret}`;
}
const PAPER="https://paper-api.alpaca.markets/v2";

export async function GET(request:Request){
  if(!authorized(request))return reply({error:"Unauthorized."},401);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Audit storage unavailable."},503);
  const now=new Date();
  const windowStart=new Date(now.getTime()-7*86400000).toISOString();
  try{
    const db=createAdminSupabaseClient();
    const [ledgers,performance,crons,virtualPositions,dbOrders,fills,scenarios,reservations]=await Promise.all([
      db.from("paper_bot_ledgers").select("bot_id,strategy_id,strategy_version,status,starting_cash,cash,equity,metadata").limit(20),
      db.from("paper_bot_performance_audit_v1").select("bot_id,candidate_checks_7d,broker_buy_orders,filled_buy_orders,closed_trades,latest_candidate_at,authorizations_7d").limit(20),
      db.from("paper_bot_cron_health").select("bot_id,job_key,last_success_at,last_failure_at,consecutive_failures").limit(100),
      db.from("paper_bot_positions").select("bot_id,symbol,quantity,protective_stop").limit(1000),
      db.from("paper_bot_broker_orders").select("bot_id,broker_order_id,client_order_id,symbol,side,status").limit(5000),
      db.from("paper_bot_broker_fills").select("fill_activity_id",{head:true,count:"exact"}).is("ledger_applied_at",null),
      db.from("paper_shared_portfolio_scenarios").select("scenario_id,policy_id,state,initial_equity,equity,cash,reserved_cash,paper_only,broker_execution_enabled,updated_at").limit(50),
      db.from("paper_shared_capital_reservations").select("scenario_id,status,planned_notional").limit(2000),
    ]);
    if(ledgers.error||performance.error||crons.error||virtualPositions.error||
       dbOrders.error||fills.error||scenarios.error||reservations.error||
       !ledgers.data||!performance.data||!crons.data||!virtualPositions.data||
       !dbOrders.data||!scenarios.data||!reservations.data)
      return reply({error:"Audit evidence unavailable; no successful classification issued."},503);
    // A row cap must never silently turn missing orders into confirmed attribution.
    if(dbOrders.data.length===5000||scenarios.data.length===50||reservations.data.length===2000)
      return reply({error:"Broker journal exceeded the safe audit window; explicit pagination required."},503);

    let brokerOrders:AuditBrokerOrder[]|null=null;
    let brokerPositions:AuditBrokerPosition[]|null=null;
    let brokerReadError=false;
    const key=process.env.ALPACA_API_KEY_ID?.trim()??"";
    const secret=process.env.ALPACA_API_SECRET_KEY?.trim()??"";
    if(key&&secret){
      const headers={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,Accept:"application/json"};
      try{
        const brokerRead=(path:string)=>fetch(PAPER+"/"+path,{
          method:"GET",headers,cache:"no-store",signal:AbortSignal.timeout(12000)});
        const [orders,positions]=await Promise.all([
          brokerRead("orders?status=all&limit=500&nested=false"),
          brokerRead("positions"),
        ]);
        if(!orders.ok||!positions.ok)throw Error("PAPER broker read unavailable.");
        const orderData:unknown=await orders.json();
        const positionData:unknown=await positions.json();
        if(!Array.isArray(orderData)||!Array.isArray(positionData)||orderData.length>=500)
          throw Error("PAPER broker response is incomplete.");
        brokerOrders=orderData as AuditBrokerOrder[];
        brokerPositions=positionData as AuditBrokerPosition[];
      }catch{brokerReadError=true;}
    }else brokerReadError=true;

    const report=buildPaperEightBotAudit({
      asOf:now.toISOString(),windowStart,
      ledgers:ledgers.data as AuditLedger[],
      performance:performance.data as AuditPerformance[],
      cron:crons.data as AuditCron[],
      virtualPositions:virtualPositions.data as AuditDbPosition[],
      dbBrokerOrders:dbOrders.data as AuditDbOrder[],
      brokerOrders,brokerPositions,
      fillsUnapplied:fills.count??null,brokerReadError,
    });
    const challengeScenarios=scenarios.data.map(s=>{
      const holds=reservations.data.filter(r=>r.scenario_id===s.scenario_id&&r.status==="active");
      const heldTotal=holds.reduce((sum,r)=>sum+Number(r.planned_notional??0),0);
      return {
        challengeId:s.scenario_id,legacyScenarioId:s.scenario_id,policyId:s.policy_id,
        mode:s.state,startingCapitalUsd:Number(s.initial_equity),
        equityUsd:Number(s.equity),cashUsd:Number(s.cash),
        recordedReservedCashUsd:Number(s.reserved_cash),
        activePreviewHoldCount:holds.length,activePreviewHoldNotionalUsd:heldTotal,
        paperOnly:s.paper_only,brokerExecutionEnabled:s.broker_execution_enabled,
        brokerIsolationVerified:false,
        observationOnly:s.state==="preview"&&s.broker_execution_enabled===false,
        lastUpdatedAt:s.updated_at,
      };
    });
    const unsafeScenarios=challengeScenarios.filter(s=>
      s.paperOnly!==true||s.brokerExecutionEnabled!==false||
      Math.abs(s.activePreviewHoldNotionalUsd-s.recordedReservedCashUsd)>0.01);
    return reply({...report,
      challengeArchitecture:{
        status:"audit-only adapter required",
        strategyCapitalExternallyInjected:false,
        perInstanceLedgerAndJournalIsolationVerified:false,
        brokerAccountsIndependentlyIsolated:false,
        catalogAndMidasOrderPermission:false,
        physicalConcurrentBrokerExecutionAllowed:false,
      },
      challengeScenarios,
      legacyCapitalSnapshot:{
        botLedgerCount:ledgers.data.length,
        legacyStartingCapitalUsd:ledgers.data.reduce((sum,r)=>sum+Number(r.starting_cash??0),0),
        legacyHistoriesLeftUnchanged:true,
      },
      criticalScenarioInvariants:unsafeScenarios.map(s=>s.challengeId+
        ": preview reservations/capital/execution state requires independent review."),
    });
  }catch{
    return reply({error:"Read-only audit failed closed."},503);
  }
}
