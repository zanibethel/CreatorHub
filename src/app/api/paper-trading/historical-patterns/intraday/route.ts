import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

export const dynamic="force-dynamic";
/** Public read-only research, never a submit-order endpoint. */
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;
 const symbol=params.get("symbol")?.toUpperCase().replace("-","/")??null;
 const cls=params.get("assetClass");
 if(symbol&&!/^[A-Z0-9./]{2,20}$/.test(symbol))return NextResponse.json({error:"Invalid symbol."},{status:400});
 if(cls&&cls!=="stock"&&cls!=="crypto")return NextResponse.json({error:"Invalid asset class."},{status:400});
 try{
  const db=createAdminSupabaseClient();
  let query=db.from("paper_intraday_pattern_scores")
   .select("asset_class,symbol,horizon,target_pct,model_version,as_of,status,shadow_score,compared_examples,baseline_hit_rate,matched_hit_rate,outcome_summary,micro,features")
   .order("as_of",{ascending:false}).limit(180);
  if(symbol)query=query.eq("symbol",symbol);
  if(cls)query=query.eq("asset_class",cls);
  const result=await query;
  if(result.error)throw result.error;
  return NextResponse.json({collectedAt:new Date().toISOString(),mode:"intraday-shadow-research-v2",
   advisoryOnly:true,executionEnabled:false,
   note:"Completed 1-hour historical patterns and independent five-minute microstructure. Scores are similarity indices, not expected returns. Historical overlap and data coverage limit interpretation.",
   patterns:result.data??[]},{headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=120"}});
 }catch{return NextResponse.json({error:"Intraday research unavailable"},{status:503,
  headers:{"Cache-Control":"no-store"}});}
}
