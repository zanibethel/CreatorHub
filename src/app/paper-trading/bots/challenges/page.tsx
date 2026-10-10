import type {Metadata} from "next";
import Link from "next/link";
import {isVerifiedPaperChallengeOwner} from "@/lib/paper-challenge-owner-auth";
import PaperChallengeManager from "@/components/PaperChallengeManager";
export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"PAPER Challenge Manager | BigOrders",
 description:"Private BigOrders shadow challenge configuration and virtual capital accounting.",
};
export default async function ChallengeManagerPage(){
 const owner=await isVerifiedPaperChallengeOwner();
 if(!owner)return <main style={{maxWidth:720,margin:"10vh auto",padding:"26px",color:"#e8f3fa"}}>
   <p style={{color:"#53cde3",fontWeight:700,letterSpacing:2,fontSize:12}}>BIGORDERS · PROTECTED</p>
   <h1>Challenge Manager access required</h1>
   <p>This control panel is available only to the verified CreatorHub owner. General CreatorHub full-access accounts do not have permission.</p>
   <p><Link style={{color:"#7be4f6"}} href="/">Sign in or return to CreatorHub</Link></p>
   <p><Link style={{color:"#7be4f6"}} href="/paper-trading/bots">Back to Bot Lab</Link></p>
 </main>;
 return <PaperChallengeManager/>;
}
