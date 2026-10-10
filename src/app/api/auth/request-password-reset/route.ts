import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
export const dynamic="force-dynamic";
const resetUrl="https://creatorhub-gray.vercel.app/auth/recover";
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||
  "https://yufptpfiwdbzzrvhkvux.supabase.co";
const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
  "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,
  headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
/** Public password recovery using Supabase Auth's email verification.
 * Deliberately uses an unauthenticated, non-persistent implicit-flow client:
 * the one-time email redirect works when the user opens Gmail on a
 * different browser/device than the one that requested the reset.
 * Recovery fragments are consumed and stripped by /auth/recover.
 */
export async function POST(request:NextRequest){
  const origin=request.headers.get("origin");
  if(!origin||origin!==new URL(request.url).origin||
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
    return json({error:"Same-origin JSON required."},403);
  let body:unknown;
  try{
    const raw=await request.text();
    if(raw.length>1000)return json({error:"Request too large."},413);
    body=JSON.parse(raw);
  }catch{return json({error:"Invalid reset request."},400);}
  if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).some(k=>k!=="email"))
    return json({error:"Invalid reset request."},400);
  const email=(body as {email?:unknown}).email;
  if(typeof email!=="string"||email.length>254||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return json({error:"Enter a valid email address."},400);
  try{
    const auth=createClient(supabaseUrl,publishableKey,{auth:{
      flowType:"implicit",persistSession:false,
      detectSessionInUrl:false,autoRefreshToken:false,
    }});
    const {error}=await auth.auth.resetPasswordForEmail(email.trim(),{
      redirectTo:resetUrl,
    });
    if(error){
      if(error.status===429)return json({error:
        "Too many reset requests. Try again later or check for the previous email."},429);
      return json({error:"Password-reset email is unavailable right now. Try again later."},503);
    }
    // Do not confirm whether an account exists.
    return json({ok:true,message:
      "If the address belongs to a CreatorHub account, check its inbox and spam folder for a password-reset email."});
  }catch{
    return json({error:"Password-reset email is unavailable right now. Try again later."},503);
  }
}
