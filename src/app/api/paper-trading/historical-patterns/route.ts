import {NextResponse} from "next/server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

export const dynamic="force-dynamic";

/** Public, read-only shadow research. It never calls an execution service. */
export async function GET(request:Request) {
  const url=new URL(request.url);
  const symbol=url.searchParams.get("symbol")?.toUpperCase().replace("-", "/") ?? null;
  const assetClass=url.searchParams.get("assetClass");
  if(symbol && !/^[A-Z0-9./]{2,20}$/.test(symbol)) {
    return NextResponse.json({error:"Invalid symbol."},{status:400});
  }
  if(assetClass && assetClass!=="stock"&&assetClass!=="crypto") {
    return NextResponse.json({error:"Invalid asset class."},{status:400});
  }
  try {
    const db=createAdminSupabaseClient();
    let query=db.from("paper_historical_pattern_scores")
      .select("asset_class,symbol,horizon,target_pct,model_version,as_of,status,shadow_score,matched_count,baseline_hit_rate,similar_hit_rate,ambiguous_count,backtest_evidence")
      .order("as_of",{ascending:false}).limit(150);
    if(symbol) query=query.eq("symbol",symbol);
    if(assetClass) query=query.eq("asset_class",assetClass);
    const {data,error}=await query;
    if(error) throw new Error("Research store unavailable.");
    return NextResponse.json({
      collectedAt:new Date().toISOString(),mode:"shadow-research",
      advisoryOnly:true,executionEnabled:false,
      disclaimer:"Scores are relative similarity indices, not expected returns, probabilities, or trading instructions. Daily-bar pilot.",
      patterns:data??[],
    },{headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=120"}});
  } catch {
    return NextResponse.json({error:"Historical pattern results are temporarily unavailable."},{
      status:503,headers:{"Cache-Control":"no-store"},
    });
  }
}
