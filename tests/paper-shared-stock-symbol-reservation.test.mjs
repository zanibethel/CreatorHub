import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261009052000_shared_stock_symbol_reservations_phase1.sql",import.meta.url),"utf8");
const block=(name,end)=>{
  const start=sql.indexOf("CREATE OR REPLACE FUNCTION public."+name);
  assert.ok(start>=0,"Missing function "+name);
  const finish=sql.indexOf("END $$",start);
  assert.ok(finish>start,"Missing PLPGSQL END for "+name);
  return sql.slice(start,finish+6);
};
test("shared PAPER symbol uses a persistent unique active reservation and forbids public writes",()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.paper_stock_symbol_reservations/);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS paper_stock_symbol_active_symbol[\s\S]*?ON public\.paper_stock_symbol_reservations\(symbol\) WHERE status='active'/);
  assert.match(sql,/ALTER TABLE public\.paper_stock_symbol_reservations ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON public\.paper_stock_symbol_reservations FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT SELECT ON public\.paper_stock_symbol_reservations TO service_role/);
  assert.doesNotMatch(sql,/GRANT (INSERT|UPDATE|DELETE) ON public\.paper_stock_symbol_reservations TO/);
  assert.match(sql,/released_at timestamptz/);
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.paper_stock_symbol_release/);
});
test("common reservation validates bot identity and locks identical physical symbols",()=>{
  const f=block("paper_stock_symbol_claim");
  assert.match(f,/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(f,/p_bot_id NOT IN \('momentum-breakout-100','penny-volatility-day-100'\)/);
  assert.match(f,/p_client_order_id !~[\s\S]*?\('?\^chb-/);
  assert.match(f,/pg_catalog\.pg_advisory_xact_lock/);
  assert.match(f,/'paper-stock:'\|\|p_symbol/);
  assert.match(f,/WHERE symbol=p_symbol AND status='active'/);
  assert.match(f,/FROM public\.paper_bot_positions[\s\S]*?symbol=p_symbol AND quantity>0/);
  assert.match(f,/FROM public\.paper_bot_orders[\s\S]*?status IN \('prepared','submitted','accepted','pending_new','partially_filled'\)/);
  assert.match(f,/INSERT INTO public\.paper_stock_symbol_reservations/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.paper_stock_symbol_claim\(text,text,text\)[\s\S]*?TO service_role/);
});
test("Pulse single-entry ledger and shared symbol claim are atomic",()=>{
  const f=block("paper_pulse_claim_fractional_pilot");
  assert.match(f,/paper_bot_ledgers[\s\S]*?FOR UPDATE/i);
  assert.match(f,/fractionalExecutionEnabled/);
  assert.match(f,/fractionalPilotClientOrderId/);
  assert.match(f,/paper_bot_orders[\s\S]*?client_order_id=p_client_order_id[\s\S]*?status='prepared'/);
  const claim=f.indexOf("paper_stock_symbol_claim");
  const ledgerUpdate=f.indexOf("update public.paper_bot_ledgers");
  assert.ok(claim>=0&&ledgerUpdate>claim,"Reserve the symbol before committing Pulse ledger slot.");
  assert.match(f,/if v_affected<>1 then raise exception/);
});
test("Fuse shares the same atomic reservation while retaining risk and cash ceilings",()=>{
  const f=block("paper_fuse_claim_pilot_entry");
  const claim=f.indexOf("paper_stock_symbol_claim");
  const orderInsert=f.indexOf("insert into public.paper_bot_orders");
  assert.ok(claim>=0&&orderInsert>claim,"Fuse must own stock before staging order.");
  assert.match(f,/v_loss > v_ledger\.equity\*0\.005/);
  assert.match(f,/v_notional > least\(v_ledger\.equity\*0\.20/);
  assert.match(f,/fusePilotEnabled/);
  assert.match(f,/fusePilotClientOrderId/);
  assert.match(f,/paper_stock_symbol_claim\([\s\S]*?'penny-volatility-day-100',p_symbol,p_client_order_id/);
});
test("source routes preserve existing pilot flags and never trade live money",()=>{
  for(const path of ["../src/app/api/paper-trading/bots/momentum-breakout-execute/route.ts",
    "../src/app/api/paper-trading/bots/fuse-execute/route.ts"]){
    const route=readFileSync(new URL(path,import.meta.url),"utf8");
    assert.match(route,/paper-api\.alpaca\.markets/);
    assert.doesNotMatch(route,/api\.alpaca\.markets(?!\/v2)/);
  }
});
