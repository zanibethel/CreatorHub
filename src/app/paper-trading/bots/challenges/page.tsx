import type {Metadata} from "next";
import {isVerifiedPaperChallengeOwner} from "@/lib/paper-challenge-owner-auth";
import {createServerSupabaseClient} from "@/lib/supabase-server";
import PaperChallengeSignIn from "@/components/PaperChallengeSignIn";
import PaperChallengeManager from "@/components/PaperChallengeManager";

export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"PAPER Challenge Manager | BigOrders",
 description:"Private BigOrders shadow challenge configuration and virtual capital accounting.",
};

/** The owner's destination stays /paper-trading/bots/challenges through
 * sign-in, instead of dropping the user into generic CreatorHub at /.
 * Owner access remains verified server-side on every page/API request.
 */
export default async function ChallengeManagerPage(){
 const owner=await isVerifiedPaperChallengeOwner();
 if(!owner){
   const supabase=await createServerSupabaseClient();
   const {data:{user},error}=await supabase.auth.getUser();
   return <PaperChallengeSignIn signedIn={!error&&Boolean(user)}
     email={!error?user?.email??null:null}/>;
 }
 return <PaperChallengeManager/>;
}
