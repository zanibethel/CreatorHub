import {createServerSupabaseClient} from "@/lib/supabase-server";
import {createAdminSupabaseClient} from "@/lib/supabase-admin";

/** Authenticated owner authorization; never trusts email text from browser,
 * user_metadata, shared "full" access, or a caller-provided ID.
 * The allowlist stores verified auth.users UUIDs and is private/service-only.
 */
export async function isVerifiedPaperChallengeOwner():Promise<boolean>{
  try{
    const session=await createServerSupabaseClient();
    const {data:{user},error}=await session.auth.getUser();
    if(error||!user||user.is_anonymous||!user.email_confirmed_at)return false;
    const db=createAdminSupabaseClient();
    const [owner,access]=await Promise.all([
      db.from("paper_challenge_owner_access").select("user_id")
        .eq("user_id",user.id).maybeSingle(),
      db.from("creatorhub_account_access").select("access_level")
        .eq("user_id",user.id).maybeSingle(),
    ]);
    return !owner.error&&!access.error&&owner.data?.user_id===user.id
      &&access.data?.access_level==="full";
  }catch{return false;}
}
