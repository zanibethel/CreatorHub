import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("src/components/PaperChallengeSignIn.tsx");
const page=read("src/app/paper-trading/bots/challenges/page.tsx");
const owner=read("src/lib/paper-challenge-owner-auth.ts");
const manager=read("src/components/PaperChallengeManager.tsx");

test("Challenge Manager renders its own sign-in rather than a link to the generic creator dashboard",()=>{
  assert.match(page,/await isVerifiedPaperChallengeOwner\(\)/);
  assert.match(page,/if\(!owner\)/);
  assert.match(page,/PaperChallengeSignIn/);
  assert.match(page,/return <PaperChallengeManager\/>/);
  assert.doesNotMatch(page,/href="\/"|redirect\("\/"\)/);
});

test("owner auth continues requiring a verified UUID and full access",()=>{
  assert.match(owner,/session\.auth\.getUser\(\)/);
  assert.match(owner,/paper_challenge_owner_access/);
  assert.match(owner,/creatorhub_account_access/);
  assert.match(owner,/owner\.data\?\.user_id===user\.id/);
  assert.match(owner,/access\.data\?\.access_level==="full"/);
  assert.doesNotMatch(ui,/CRON_SECRET|SUPABASE_SECRET_KEY|service_role|Bearer /);
  assert.match(manager,/\/api\/paper-trading\/bots\/challenges\/owner/);
});

function renderSignIn(signedIn,fetchImpl,replace){
  const exports={};
  const jsx=(type,props)=>({type,props});
  const context={
    exports,
    require(id){
      if(id==="react")return {useState:(initial)=>[initial,()=>{}]};
      if(id==="react/jsx-runtime")return {jsx,jsxs:jsx};
      if(id==="next/link")return {__esModule:true,default:"link"};
      if(id==="./PaperChallengeSignIn.module.css")return {__esModule:true,default:{}};
      throw Error("Unexpected import "+id);
    },
    fetch:fetchImpl,
    window:{location:{replace}},
    Error,
  };
  const js=ts.transpileModule(ui,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
    jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
  }}).outputText;
  vm.runInNewContext(js,context);
  const tree=exports.default({signedIn,email:signedIn?"wrong-account@example.com":null});
  const find=(node,predicate)=>{
    if(!node||typeof node!=="object")return null;
    if(Array.isArray(node))return node.map(x=>find(x,predicate)).find(Boolean)??null;
    if(predicate(node))return node;
    return find(node.props?.children,predicate);
  };
  return {tree,find};
}

test("successful owner-context login returns to the Challenge Manager path, not /",async()=>{
  let request,redirected;
  const {tree,find}=renderSignIn(false,async(path,opts)=>{
    request={path,opts};return {ok:true,json:async()=>({ok:true})};
  },path=>{redirected=path;});
  const form=find(tree,n=>n.type==="form");
  assert.ok(form,"Dedicated manager sign-in form should render.");
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(request.path,"/api/auth/login");
  assert.equal(request.opts.method,"POST");
  assert.equal(request.opts.credentials,"same-origin");
  assert.equal(redirected,"/paper-trading/bots/challenges");
  assert.notEqual(redirected,"/");
});

test("failed password login stays on the manager form and cannot redirect to another domain",async()=>{
  let redirected=null;
  const {tree,find}=renderSignIn(false,async()=>({
    ok:false,json:async()=>({error:"Invalid credentials"}),
  }),path=>{redirected=path;});
  await find(tree,n=>n.type==="form").props.onSubmit({preventDefault(){}});
  assert.equal(redirected,null);
});

test("a session without owner access can switch accounts without visiting CreatorHub /",async()=>{
  let request=null,redirected=null;
  const {tree,find}=renderSignIn(true,async(path,opts)=>{
    request={path,opts};return {ok:true};
  },path=>{redirected=path;});
  assert.equal(find(tree,n=>n.type==="form"),null);
  const button=find(tree,n=>n.type==="button"&&String(n.props.children).includes("Switch to owner account"));
  assert.ok(button);
  button.props.onClick();
  // The UI intentionally fires-and-forgets sign-out from its click handler;
  // allow the async fetch and navigation microtasks to finish before asserting.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(request.path,"/api/auth/logout");
  assert.equal(request.opts.credentials,"same-origin");
  assert.equal(redirected,"/paper-trading/bots/challenges");
});
