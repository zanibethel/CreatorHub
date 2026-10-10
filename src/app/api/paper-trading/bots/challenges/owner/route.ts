import {NextResponse} from "next/server";
import {isVerifiedPaperChallengeOwner} from "@/lib/paper-challenge-owner-auth";
import {loadPaperChallengeRegistry} from "@/lib/paper-challenge-registry-service";
import {shadowManageSchema,executeShadowManage} from "@/lib/paper-challenge-manage-service";
export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,
  headers:{"Cache-Control":"private, no-store, max-age=0",
    "X-Paper-Execution":"disabled","X-Content-Type-Options":"nosniff"}});
/** Owner-session route. Never use CRON_SECRET in the browser. */
export async function GET(){
  if(!await isVerifiedPaperChallengeOwner())return reply({error:"Owner access required."},403);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Storage unavailable."},503);
  try{return reply(await loadPaperChallengeRegistry());}
  catch{return reply({error:"Challenge registry is unavailable."},503);}
}
export async function POST(request:Request){
  if(!await isVerifiedPaperChallengeOwner())return reply({error:"Owner access required."},403);
  // Even valid cookie sessions must not enable cross-origin mutations.
  const origin=request.headers.get("origin");
  if(!origin||origin!==new URL(request.url).origin||
     request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
    return reply({error:"Same-origin JSON required."},403);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Storage unavailable."},503);
  let raw:string;
  try{raw=await request.text();}catch{return reply({error:"Unreadable request."},400);}
  if(raw.length>24_000)return reply({error:"Request exceeds size limit."},413);
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return reply({error:"Invalid JSON."},400);}
  const validated=shadowManageSchema.safeParse(parsed);
  if(!validated.success)return reply({error:"Invalid PAPER shadow challenge request."},400);
  try{
    const result=await executeShadowManage(validated.data);
    return reply({paperOnly:true,brokerOrderAuthorized:false,result});
  }catch{
    return reply({error:"Challenge change rejected. Refresh your balances and version, then review the request."},409);
  }
}
