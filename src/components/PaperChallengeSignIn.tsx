"use client";

import {FormEvent,useState} from "react";
import Link from "next/link";
import styles from "./PaperChallengeSignIn.module.css";

const MANAGER_PATH="/paper-trading/bots/challenges";

/** Dedicated owner sign-in: reuse the existing Supabase SSR cookie login,
 * and return to the exact manager path rather than the CreatorHub homepage.
 * This component never receives a service role, owner UUID or CRON secret.
 */
export default function PaperChallengeSignIn({signedIn,email}:{
  signedIn:boolean;email?:string|null;
}){
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState("");
  const [resetMode,setResetMode]=useState(false);

  async function signIn(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(pending)return;
    setPending(true);setMessage("");
    try{
      const response=await fetch("/api/auth/login",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:username.trim(),password}),
      });
      const data=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(data.error||"Sign-in failed. Try again.");
      // Hard-coded internal destination: cannot become an open redirect.
      window.location.replace(MANAGER_PATH);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Could not sign in.");
      setPending(false);
    }
  }

  async function requestPasswordReset(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(pending)return;
    setPending(true);setMessage("");
    try{
      const response=await fetch("/api/auth/request-password-reset",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:username.trim()}),
      });
      const data=await response.json().catch(()=>({})) as {error?:string;message?:string};
      if(!response.ok)throw Error(data.error||"Unable to request a reset email.");
      setMessage(data.message||"If an account exists, check its inbox and spam folder for a reset link.");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Unable to request a reset email.");
    }finally{setPending(false);}
  }

  async function switchAccount(){
    if(pending)return;
    setPending(true);setMessage("");
    try{
      const response=await fetch("/api/auth/logout",{
        method:"POST",credentials:"same-origin",cache:"no-store",
      });
      if(!response.ok)throw new Error("Unable to sign out. Please try again.");
      window.location.replace(MANAGER_PATH);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Unable to switch accounts.");
      setPending(false);
    }
  }

  return <main className={styles.shell}>
    <div className={styles.panel}>
      <div className={styles.eyebrow}>BIGORDERS · PAPER TRADING</div>
      <h1>Challenge Manager</h1>
      <p className={styles.intro}>Sign in here to manage your independent PAPER challenges.
        After signing in, you&apos;ll return directly to the Challenge Manager—not the AI Creator dashboard.</p>
      {signedIn?
        <section aria-label="Challenge Manager account access">
          <div className={styles.alert}>
            This CreatorHub session does not have Challenge Manager owner access.
            {email&&<div className={styles.email}>Currently signed in: {email}</div>}
          </div>
          <p className={styles.hint}>The Challenge Manager requires the specific verified owner account.
            General CreatorHub accounts, including other full-access accounts, cannot manage these portfolios.</p>
          <button type="button" className={styles.primary} disabled={pending}
            onClick={()=>void switchAccount()}>
            {pending?"Signing out…":"Switch to owner account"}
          </button>
        </section>:
        <form onSubmit={resetMode?requestPasswordReset:signIn}>
          <label className={styles.field}>
            Account email
            <input type="email" autoComplete="username" required value={username}
              disabled={pending} onChange={e=>setUsername(e.target.value)}
              placeholder="Your CreatorHub owner email"/>
          </label>
          {!resetMode&&<label className={styles.field}>
            Password
            <input type="password" autoComplete="current-password" required
              value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}
              placeholder="Password"/>
          </label>}
          {resetMode&&<p className={styles.hint}>We'll email a secure reset link for your existing CreatorHub account. Open the email to choose a new password, then return directly to BigOrders.</p>}
          <button type="submit" className={styles.primary} disabled={pending}>
            {resetMode?(pending?"Requesting link…":"Email me a password-reset link"):
              (pending?"Signing in…":"Sign in to Challenge Manager")}
          </button>
          <button type="button" className={styles.textButton} disabled={pending}
            onClick={()=>{
              setMessage("");setPassword("");setResetMode(value=>!value);
            }}>
            {resetMode?"Back to sign in":"Forgot password?"}
          </button>
        </form>}
      {message&&<p className={styles.error} role="alert">{message}</p>}
      <div className={styles.footer}>
        <Link href="/paper-trading/bots">← Back to Bot Lab</Link>
        <span>Owner access only · No real-money trading</span>
      </div>
    </div>
  </main>;
}
