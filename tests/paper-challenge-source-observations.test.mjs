import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=file("supabase/migrations/20261010060000_paper_challenge_source_observations_v1.sql");
const cron=file("src/app/api/paper-trading/bots/challenges/observations/cron/route.ts");
const owner=file("src/app/api/paper-trading/bots/challenges/observations/route.ts");
const service=file("src/lib/paper-challenge-source-observations-service.ts");
const ui=file("src/components/PaperChallengeManager.tsx");
const vercel=JSON.parse(file("vercel.json"));
test("source observations must be scoped to challenge, instance and immutable source-journal id",()=>{
 assert.match(sql,/PRIMARY KEY\(challenge_id,bot_instance_id,source_journal_id\)/);
 assert.match(sql,/REFERENCES public\.paper_bot_journal\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/paper_challenge_source_observations_immutable/);
 assert.match(sql,/paper_challenge_refuse_journal_mutation/);
 assert.match(sql,/ON CONFLICT \(challenge_id,bot_instance_id,source_journal_id\) DO NOTHING/);
 assert.match(sql,/GREATEST\(v_challenge\.created_at,v_i\.created_at\)/);
});
test("source replay is strict PAPER research only: no simulated profit, quote validation or broker grants",()=>{
 for(const value of ["challenge_strategy_revalidated","validated_quote_available",
   "simulated_fill_verified","hypothetical_pl_usd","broker_order_authorized"]){
  assert.match(sql,new RegExp(value));
 }
 assert.match(sql,/CHECK\(hypothetical_pl_usd IS NULL\)/);
 assert.match(sql,/CHECK\(broker_order_authorized=false\)/);
 assert.match(sql,/CHECK\(simulated_fill_verified=false\)/);
 assert.match(sql,/CHECK\(challenge_strategy_revalidated=false\)/);
 assert.match(sql,/SELECT j\.id,j\.bot_id,j\.strategy_id,j\.strategy_version/);
 assert.doesNotMatch(sql,/UPDATE public\.paper_bot_ledgers|UPDATE public\.paper_challenge_capital_accounts/);
 assert.doesNotMatch(sql,/ALPACA|paper-api\.alpaca|INSERT INTO public\.paper_bot_orders/);
});
test("DB provenance and strategy identity are mandatory, with bounded source sync",()=>{
 assert.match(sql,/j\.strategy_id=v_i\.strategy_id AND j\.strategy_version=v_i\.strategy_version/);
 assert.match(sql,/j\.bot_id=v_i\.legacy_source_bot_id/);
 assert.match(sql,/p_limit_per_instance NOT BETWEEN 1 AND 15/);
 assert.match(sql,/j\.event_type IN \('candidate','rejected','scanner_assigned'\)/);
 assert.match(sql,/v_challenge\.lifecycle<>'preview'/);
 assert.match(sql,/v_challenge\.broker_execution_enabled/);
});
test("shadow observation RLS and internal RPC cannot be called by public JWT roles",()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON TABLE public\.paper_challenge_source_observations FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.paper_challenge_sync_source_observations/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.paper_challenge_sync_source_observations/);
 assert.match(sql,/security_invoker=true/);
 assert.match(sql,/GRANT SELECT ON TABLE public\.paper_challenge_source_observation_summary TO service_role/);
});
test("owner and cron routes independently authenticate and do not expose privileged secrets to browsers",()=>{
 assert.match(owner,/isVerifiedPaperChallengeOwner/);
 assert.match(owner,/origin.*new URL\(request\.url\)\.origin/);
 assert.match(owner,/Same-origin JSON required/);
 assert.doesNotMatch(owner,/process\.env\.CRON_SECRET|ALPACA_API_KEY/);
 assert.match(cron,/CRON_SECRET/);
 assert.match(cron,/failed\.length\?503:200/);
 assert.match(service,/sourceOnly:true/);
 assert.match(service,/brokerOrderAuthorized:false/);
});
test("UI shows only independently scoped source evidence, does not claim simulated profits",()=>{
 assert.match(ui,/observations24h/);
 assert.match(ui,/totalSourceObservations/);
 assert.match(ui,/Capture latest source observations/);
 assert.match(ui,/Recorded shadow P\/L: not yet measured/);
 assert.match(ui,/source-attribution only/);
 assert.doesNotMatch(ui,/SUPABASE_SECRET_KEY|ALPACA_API_SECRET_KEY/);
});
test("source-only cron is scheduled separately from all legacy executors",()=>{
 const match=vercel.crons.filter(x=>x.path==="/api/paper-trading/bots/challenges/observations/cron");
 assert.equal(match.length,1);
 assert.equal(match[0].schedule,"*/15 * * * *");
 assert.ok(vercel.crons.find(x=>x.path==="/api/paper-trading/bots/crypto-ignition-run"));
});
