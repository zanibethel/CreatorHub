import {NextResponse} from "next/server";
import {loadPaperChallengeRegistry} from "@/lib/paper-challenge-registry-service";

export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{
  "Cache-Control":"no-store","X-Paper-Execution":"disabled",
}});
const allowed=(request:Request)=>{
  const secret=process.env.CRON_SECRET?.trim()??"";
  return secret.length>=32&&request.headers.get("authorization")===`Bearer ${secret}`;
};
/** Existing secret-protected read-only endpoint; never public. */
export async function GET(request:Request){
  if(!allowed(request))return reply({error:"Unauthorized."},401);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Registry unavailable."},503);
  try{return reply(await loadPaperChallengeRegistry());}
  catch{return reply({error:"Read-only registry retrieval failed."},503);}
}
