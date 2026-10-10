import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const requestRoute=read("src/app/api/auth/request-password-reset/route.ts");
const recovery=read("src/components/PaperChallengeRecovery.tsx");
const signIn=read("src/components/PaperChallengeSignIn.tsx");
const proxy=read("proxy.ts");
const ownerPage=read("src/app/paper-trading/bots/challenges/page.tsx");
const passwordRoute=read("src/app/api/auth/change-password/route.ts");

function makeRoute(reset){
 const exports={};
 const responses={
   json(body,{status=200}={}){return {body,status};}
 };
 const deps={
   "next/server":{NextResponse:responses},
   "@supabase/supabase-js":{createClient:(url,key,options)=>({
     auth:{resetPasswordForEmail:(email,settings)=>reset({url,key,options,email,settings})},
   })},
 };
 const js=ts.transpileModule(requestRoute,{compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
 }}).outputText;
 vm.runInNewContext(js,{exports,process:{env:{}},require:id=>{
   if(!(id in deps))throw Error("Unexpected import: "+id);
   return deps[id];
 }});
 return exports.POST;
}
function request({email="owner@example.com",origin="https://creatorhub-gray.vercel.app",
  url="https://creatorhub-gray.vercel.app/api/auth/request-password-reset",
  contentType="application/json",body}={}){
 return {headers:{get(name){
   return {"origin":origin,"content-type":contentType}[name]??null;
 }},url,text:async()=>body??JSON.stringify({email})};
}

test("password reset cannot be sent cross-origin or with malformed input",async()=>{
 let calls=0;
 const handler=makeRoute(()=>{calls++;return Promise.resolve({error:null});});
 assert.equal((await handler(request({origin:"https://evil.example"}))).status,403);
 assert.equal((await handler(request({email:"bad@notdomain"}))).status,400);
 assert.equal((await handler(request({body:JSON.stringify({email:"owner@example.com",redirectTo:"https://evil.example"})}))).status,400);
 assert.equal(calls,0);
});
test("reset API uses public Supabase, a fixed BigOrders return URL, and generic acceptance",async()=>{
 let called=null;
 const handler=makeRoute(async input=>{called=input;return {error:null};});
 const result=await handler(request({email:"owner@example.com"}));
 assert.equal(result.status,200);
 assert.equal(result.body.ok,true);
 assert.match(result.body.message,/If the address belongs/);
 assert.equal(called.email,"owner@example.com");
 assert.equal(called.settings.redirectTo,"https://creatorhub-gray.vercel.app/auth/recover");
 assert.equal(called.options.auth.flowType,"implicit");
 assert.equal(called.options.auth.persistSession,false);
 assert.equal(called.options.auth.detectSessionInUrl,false);
 assert.ok(!("SUPABASE_SECRET_KEY" in requestRoute));
});
test("reset API returns rate-limited or failed delivery status without exposing private auth details",async()=>{
 const limited=makeRoute(async()=>({error:{status:429,message:"internal"}}));
 const unavailable=makeRoute(async()=>({error:{status:500,message:"private failure"}}));
 assert.equal((await limited(request())).status,429);
 const r=await unavailable(request());
 assert.equal(r.status,503);
 assert.doesNotMatch(r.body.error,/private failure/);
});
test("recovery page handles email link proof then strips secrets before a same-origin password change",()=>{
 assert.match(recovery,/fragment\.get\("access_token"\)/);
 assert.match(recovery,/fragment\.get\("refresh_token"\)/);
 assert.match(recovery,/hashType==="recovery"/);
 assert.match(recovery,/supabase\.auth\.setSession/);
 assert.match(recovery,/supabase\.auth\.verifyOtp/);
 assert.match(recovery,/supabase\.auth\.exchangeCodeForSession/);
 assert.match(recovery,/window\.history\.replaceState/);
 assert.match(recovery,/supabase\.auth\.getUser/);
 assert.match(recovery,/fetch\("\/api\/auth\/change-password"/);
 assert.match(recovery,/window\.location\.replace|href=\{manager\}/);
 assert.doesNotMatch(recovery,/auth\.admin\.updateUserById|service_role/);
});
test("Challenge Manager offers generic self-service reset, owner access is not changed",()=>{
 assert.match(signIn,/Forgot password\?/);
 assert.match(signIn,/requestPasswordReset/);
 assert.match(signIn,/\/api\/auth\/request-password-reset/);
 assert.match(signIn,/Email me a password-reset link/);
 assert.match(ownerPage,/isVerifiedPaperChallengeOwner/);
 assert.match(passwordRoute,/supabase\.auth\.getUser\(\)/);
 assert.match(passwordRoute,/supabase\.auth\.updateUser\(\{ password \}\)/);
 assert.doesNotMatch(signIn,/SUPABASE_SECRET_KEY|CRON_SECRET/);
});
test("recovery is reachable even with unrelated restricted account sessions",()=>{
 assert.match(proxy,/pathname === "\/auth\/recover"/);
 assert.match(proxy,/pathname === "\/api\/auth\/request-password-reset"/);
});
