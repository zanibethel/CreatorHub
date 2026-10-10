import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import ts from "typescript";
const file=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const auth=file("src/lib/paper-challenge-owner-auth.ts");
const ownerRoute=file("src/app/api/paper-trading/bots/challenges/owner/route.ts");
const manager=file("src/components/PaperChallengeManager.tsx");
const page=file("src/app/paper-trading/bots/challenges/page.tsx");
const ownerMigration=file("supabase/migrations/20261010050000_paper_challenge_owner_access_v1.sql");
const legacyOp=file("src/app/api/paper-trading/bots/challenges/manage/route.ts");
const legacyRead=file("src/app/api/paper-trading/bots/challenges/route.ts");

async function ownerDecision(user,allowlisted,access="full",queryError=false){
 const exports={};
 const db={from:(name)=>({select:()=>({eq:()=>({
   maybeSingle:async()=>name==="paper_challenge_owner_access"?
     {data:allowlisted?{user_id:user?.id}:null,error:queryError?{message:"error"}:null}:
     {data:{access_level:access},error:null},
 })})})};
 const mocks={
   "@/lib/supabase-server":{createServerSupabaseClient:async()=>({
     auth:{getUser:async()=>({data:{user},error:null})},
   })},
   "@/lib/supabase-admin":{createAdminSupabaseClient:()=>db},
 };
 const compiled=ts.transpileModule(auth,{compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
 }}).outputText;
 vm.runInNewContext(compiled,{exports,require:(name)=>{
   if(!(name in mocks))throw Error("Unexpected imported dependency.");
   return mocks[name];
 }});
 return await exports.isVerifiedPaperChallengeOwner();
}
const user={id:"verified-owner-user-id",email_confirmed_at:"2026-01-01",is_anonymous:false};
test("not logged in, anonymous, and unverified accounts cannot manage challenges",async()=>{
 assert.equal(await ownerDecision(null,true),false);
 assert.equal(await ownerDecision({...user,email_confirmed_at:null},true),false);
 assert.equal(await ownerDecision({...user,is_anonymous:true},true),false);
});
test("full CreatorHub account without exact owner UUID is denied",async()=>{
 assert.equal(await ownerDecision(user,false,"full"),false);
 assert.equal(await ownerDecision(user,true,"upload_only"),false);
 assert.equal(await ownerDecision(user,true,"full",true),false);
});
test("verified owner UUID with current full access passes server-only check",async()=>{
 assert.equal(await ownerDecision(user,true,"full"),true);
});
test("owner bootstrap is exact verified identity, RLS denied and cannot derive from full alone",()=>{
 assert.match(ownerMigration,/REFERENCES auth\.users\(id\)/);
 assert.match(ownerMigration,/email_confirmed_at IS NOT NULL/);
 assert.match(ownerMigration,/lower\(u\.email\)=/);
 assert.match(ownerMigration,/v_count<>1/);
 assert.match(ownerMigration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(ownerMigration,/REVOKE ALL ON TABLE .* FROM PUBLIC,anon,authenticated/);
 assert.match(ownerMigration,/GRANT SELECT .*service_role/);
 assert.doesNotMatch(ownerMigration,/GRANT INSERT .*authenticated/);
});
test("owner UI route authenticates on every read and write and rejects cross-origin submissions",()=>{
 assert.match(ownerRoute,/await isVerifiedPaperChallengeOwner\(\)/g);
 assert.match(ownerRoute,/origin!==new URL\(request\.url\)\.origin/);
 assert.match(ownerRoute,/content-type/);
 assert.match(ownerRoute,/shadowManageSchema\.safeParse/);
 assert.match(ownerRoute,/executeShadowManage/);
 assert.match(ownerRoute,/Cache-Control.*private/);
 assert.doesNotMatch(ownerRoute,/process\\.env\\.CRON_SECRET|ALPACA_API_KEY|ALPACA_API_SECRET/);
 assert.match(page,/await isVerifiedPaperChallengeOwner\(\)/);
 assert.match(page,/if\(!owner\)/);
});
test("browser UI uses only owner-session URL and never embeds admin service credentials",()=>{
 assert.match(manager,/\/api\/paper-trading\/bots\/challenges\/owner/);
 assert.doesNotMatch(manager,/SUPABASE_SECRET_KEY|CRON_SECRET|service_role|Bearer /);
 assert.match(manager,/credential|credentials:"same-origin"/);
 assert.match(manager,/broker.*execution disabled|No PAPER broker execution/i);
 assert.match(manager,/researchContributors/);
 assert.match(manager,/expectedVersion/);
 assert.match(manager,/fundingKey/);
 assert.match(manager,/window\.confirm/);
});
test("CRON-only operator routes stay secret-protected and separate from owner sessions",()=>{
 assert.match(legacyOp,/CRON_SECRET/);
 assert.match(legacyRead,/CRON_SECRET/);
 assert.doesNotMatch(legacyOp,/isVerifiedPaperChallengeOwner/);
 assert.doesNotMatch(legacyRead,/isVerifiedPaperChallengeOwner/);
});
