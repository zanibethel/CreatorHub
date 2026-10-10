import {NextResponse} from "next/server";
import {z} from "zod";
import {isVerifiedPaperChallengeOwner} from "@/lib/paper-challenge-owner-auth";
import {loadChallengeObservationSummaries,syncChallengeSourceObservations}
 from "@/lib/paper-challenge-source-observations-service";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{
 "Cache-Control":"private, no-store, max-age=0","X-Paper-Execution":"disabled",
 "X-Content-Type-Options":"nosniff",
}});
const inputSchema=z.object({challengeId:z.string()
 .regex(/^[a-z0-9][a-z0-9_-]{1,95}$/)}).strict();
/** Owner-only research evidence. Not strategy re-evaluation or broker trading. */
export async function GET(){
 if(!await isVerifiedPaperChallengeOwner())return reply({error:"Owner access required."},403);
 try{return reply(await loadChallengeObservationSummaries());}
 catch{return reply({error:"Source comparison is unavailable."},503);}
}
export async function POST(request:Request){
 if(!await isVerifiedPaperChallengeOwner())return reply({error:"Owner access required."},403);
 if(!request.headers.get("origin")||request.headers.get("origin")!==new URL(request.url).origin||
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
    return reply({error:"Same-origin JSON required."},403);
 let raw:string;
 try{raw=await request.text();}catch{return reply({error:"Unreadable JSON."},400);}
 if(raw.length>500)return reply({error:"Request exceeds scope limit."},413);
 let json:unknown;
 try{json=JSON.parse(raw);}catch{return reply({error:"Invalid JSON."},400);}
 const input=inputSchema.safeParse(json);
 if(!input.success)return reply({error:"Invalid challenge scope."},400);
 try{return reply(await syncChallengeSourceObservations(input.data.challengeId,12));}
 catch{return reply({error:"Challenge is inactive, unverified, or source sync was rejected."},409);}
}
