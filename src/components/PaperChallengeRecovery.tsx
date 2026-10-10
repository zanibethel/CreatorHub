"use client";
import {FormEvent,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import styles from "@/components/PaperChallengeSignIn.module.css";

const manager="/paper-trading/bots/challenges";

/** Process the one-time recovery proof in the URL fragment or PKCE query.
 * Tokens are removed from browser history before displaying the new-password form.
 * Password changes go through CreatorHub's same-origin server auth endpoint.
 */
export default function PaperChallengeRecovery(){
  const [state,setState]=useState<"verifying"|"ready"|"done"|"invalid">("verifying");
  const [message,setMessage]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        const url=new URL(window.location.href);
        const fragment=new URLSearchParams(url.hash.replace(/^#/,""));
        const code=url.searchParams.get("code");
        const tokenHash=url.searchParams.get("token_hash");
        const type=url.searchParams.get("type");
        const accessToken=fragment.get("access_token");
        const refreshToken=fragment.get("refresh_token");
        const hashType=fragment.get("type");
        // Remove any short-lived recovery codes/tokens from the visible URL,
        // including on failure. No tokens are sent to the application server.
        window.history.replaceState({}, "", url.pathname);
        const supabase=createClient();
        let error:Error|null=null;
        if(accessToken&&refreshToken&&hashType==="recovery"){
          const result=await supabase.auth.setSession({
            access_token:accessToken,refresh_token:refreshToken});
          error=result.error;
        }else if(tokenHash&&type==="recovery"){
          const result=await supabase.auth.verifyOtp({
            type:"recovery",token_hash:tokenHash});
          error=result.error;
        }else if(code){
          const result=await supabase.auth.exchangeCodeForSession(code);
          error=result.error;
        }else{
          throw Error("Open the latest recovery link in your email to continue.");
        }
        if(error)throw error;
        const {data:{user},error:userError}=await supabase.auth.getUser();
        if(userError||!user||user.is_anonymous)
          throw Error("Recovery verification did not establish a signed-in account.");
        if(alive)setState("ready");
      }catch{
        if(alive){
          setMessage("This reset link is invalid, expired, or could not be verified. Request a new link from the Challenge Manager.");
          setState("invalid");
        }
      }
    })();
    return()=>{alive=false;};
  },[]);

  async function update(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(saving||state!=="ready")return;
    if(password.length<12){setMessage("Use at least 12 characters.");return;}
    if(password!==confirm){setMessage("Passwords do not match.");return;}
    setSaving(true);setMessage("");
    try{
      const response=await fetch("/api/auth/change-password",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({password}),
      });
      const data=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw Error(data.error||"Password could not be updated.");
      setPassword("");setConfirm("");
      setState("done");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Unable to update your password.");
    }finally{setSaving(false);}
  }

  return <main className={styles.shell}>
    <div className={styles.panel}>
      <div className={styles.eyebrow}>BIGORDERS · ACCOUNT RECOVERY</div>
      <h1>Reset your password</h1>
      {state==="verifying"&&<p className={styles.intro} role="status">
        Verifying your recovery link…</p>}
      {state==="ready"&&<form onSubmit={update}>
        <p className={styles.intro}>Your recovery link has been verified. Enter a new password for your existing CreatorHub account.</p>
        <label className={styles.field}>New password
          <input type="password" required minLength={12}
            autoComplete="new-password" value={password} disabled={saving}
            onChange={event=>setPassword(event.target.value)}/>
        </label>
        <label className={styles.field}>Confirm new password
          <input type="password" required minLength={12}
            autoComplete="new-password" value={confirm} disabled={saving}
            onChange={event=>setConfirm(event.target.value)}/>
        </label>
        <button className={styles.primary} type="submit" disabled={saving}>
          {saving?"Updating password…":"Update password"}
        </button>
      </form>}
      {state==="done"&&<section role="status">
        <p className={styles.intro}>Your password has been updated for your existing CreatorHub account. You can now return directly to the BigOrders Challenge Manager.</p>
        <Link href={manager} className={styles.primaryLink}>Continue to Challenge Manager</Link>
      </section>}
      {message&&<p className={styles.error} role="alert">{message}</p>}
      {state==="invalid"&&<Link className={styles.primaryLink} href={manager}>
        Request a new reset link
      </Link>}
      <div className={styles.footer}>
        <Link href={manager}>← Challenge Manager</Link>
        <span>Verified email recovery · PAPER only</span>
      </div>
    </div>
  </main>;
}
