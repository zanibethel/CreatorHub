import {NextResponse} from "next/server";
import {shadowManageSchema,executeShadowManage} from "@/lib/paper-challenge-manage-service";

export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,
  headers:{"Cache-Control":"no-store","X-Paper-Execution":"disabled"}});
function authorized(req:Request){
  const secret=process.env.CRON_SECRET?.trim()??"";
  return secret.length>=32 && req.headers.get("authorization")===`Bearer ${secret}`;
}
/** Preserves Step 4 operator-secret route. Never exposed to public browsers. */
export async function POST(request:Request){
  if(!authorized(request))return reply({error:"Unauthorized."},401);
  if(!process.env.SUPABASE_SECRET_KEY)return reply({error:"Admin storage unavailable."},503);
  let raw:string;
  try{raw=await request.text();}catch{return reply({error:"Unreadable request."},400);}
  if(raw.length>24_000)return reply({error:"Request exceeds limit."},413);
  let parsedJson:unknown;
  try{parsedJson=JSON.parse(raw);}catch{return reply({error:"Invalid JSON."},400);}
  const parsed=shadowManageSchema.safeParse(parsedJson);
  if(!parsed.success)return reply({error:"Invalid PAPER shadow challenge request."},400);
  try{
    const result=await executeShadowManage(parsed.data);
    return reply({paperOnly:true,brokerOrderAuthorized:false,operatorAuthenticated:true,result});
  }catch{
    return reply({error:"Shadow challenge operation rejected; no success recorded."},409);
  }
}
