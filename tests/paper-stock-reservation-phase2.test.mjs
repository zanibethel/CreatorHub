import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261009064500_shared_stock_symbol_reservations_atlas_harbor.sql",import.meta.url),"utf8");
const route=p=>readFileSync(new URL("../src/app/api/paper-trading/bots/"+p+"/route.ts",import.meta.url),"utf8");
const functionText=name=>{
 const start=sql.toLowerCase().indexOf("create or replace function public."+name);
 assert.ok(start>=0,"No function "+name);
 const end=sql.toLowerCase().indexOf("end $$;",start);
 assert.ok(end>start,"No end "+name);
 return sql.slice(start,end);
};
test("all four stock PAPER bots share the same global symbol lock",()=>{
 const claim=functionText("paper_stock_symbol_claim");
 for(const bot of ["momentum-breakout-100","penny-volatility-day-100","default-diverse","three-trade-weekly-swing-100"])
  assert.ok(claim.includes(bot),bot);
 assert.match(claim,/hashtextextended\('paper-stock:'\|\|p_symbol,0\)/);
 assert.match(claim,/paper_stock_symbol_reservations/);
 assert.match(claim,/status='active'/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public.paper_stock_symbol_claim\(text,text,text\) TO service_role/);
});
test("Atlas stock bind atomically reserves physical symbol but preserves Atlas crypto binding",()=>{
 const f=functionText("paper_atlas_bind_order");
 assert.match(f,/asset_class INTO v_symbol,v_asset_class/);
 assert.match(f,/IF v_asset_class='stock' THEN/);
 assert.match(f,/public.paper_stock_symbol_claim/);
 assert.match(f,/ELSIF v_asset_class<>'crypto' THEN/);
 assert.ok(f.indexOf("paper_stock_symbol_claim")<f.indexOf("UPDATE public.paper_atlas_reservations"));
 assert.match(f,/RAISE EXCEPTION 'Atlas binding changed after physical symbol claim'/);
 assert.match(route("atlas-run"),/verifySharedStockEntry/);
 assert.match(route("atlas-run"),/paper_stock_symbol_reservations/);
 assert.equal((route("atlas-run").match(/if\(!await verifySharedStockEntry\(/g)||[]).length,2);
});
test("Harbor makes one atomic prepared order and stock claim, never blind PATCH fallback",()=>{
 const f=functionText("paper_swing_claim_prepared_with_symbol");
 assert.match(f,/auth.role\(\) IS DISTINCT FROM 'service_role'/);
 assert.match(f,/client_order_id=p_client_order_id/);
 assert.match(f,/FOR UPDATE/);
 assert.match(f,/paper_stock_symbol_claim/);
 assert.ok(f.indexOf("paper_stock_symbol_claim")<f.indexOf("UPDATE public.paper_bot_orders"));
 assert.match(f,/RAISE EXCEPTION 'Harbor order changed after physical stock reservation'/);
 const executor=route("swing-execute");
 assert.match(executor,/rpc\/paper_swing_claim_prepared_with_symbol/);
 assert.match(executor,/Shared PAPER broker stock ownership snapshot incomplete/);
 assert.doesNotMatch(executor,/status=eq.prepared&broker_order_id=is.null/);
 const intake=route("swing-prospect-intake");
 assert.match(intake,/createPaperClientOrderId\(BOT_ID,strategy.version\)/);
 assert.doesNotMatch(intake,/chb-sw3-p3-/);
});
test("shared reservation remains conservative; no automatic stock release or live trading",()=>{
 assert.doesNotMatch(sql,/create or replace function public.paper_stock_symbol_release/i);
 assert.match(sql,/REVOKE ALL ON FUNCTION public.paper_swing_claim_prepared_with_symbol/);
 for(const file of ["swing-execute","atlas-run"]){
  const code=route(file);
  assert.match(code,/paper-api.alpaca.markets|SWING_PAPER_BROKER_HOST/);
 }
});
