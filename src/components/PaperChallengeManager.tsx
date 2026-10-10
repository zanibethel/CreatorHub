"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import styles from "./PaperChallengeManager.module.css";

type BotSource={id:string;name:string;detail:string;short:string};
const BOT_SOURCES:BotSource[]=[
 {id:"default-diverse",name:"Atlas",detail:"Diversified",short:"atlas"},
 {id:"penny-volatility-day-100",name:"Fuse",detail:"Penny volatility",short:"fuse"},
 {id:"three-trade-weekly-swing-100",name:"Harbor",detail:"Weekly swing",short:"harbor"},
 {id:"weekend-crypto-day-100",name:"Flash",detail:"Daily crypto",short:"flash"},
 {id:"momentum-breakout-100",name:"Pulse",detail:"Stock momentum",short:"pulse"},
 {id:"crypto-ignition-100",name:"Spark",detail:"Crypto ignition",short:"spark"},
 {id:"crypto-swing-100",name:"Orbit",detail:"Crypto swing",short:"orbit"},
 {id:"squeeze-breakout-100",name:"Coil",detail:"Squeeze breakout",short:"coil"},
];
type BotInstance={botInstanceId:string;strategyId:string;strategyVersion:number;
 legacySourceBotId:string|null;executionEnabled:boolean};
type Research={contributorId:string;canSubmitOrders:boolean};
type Challenge={challengeId:string;displayName:string;lifecycle:string;policyId:string;
 startingCapitalUsd:number|null;capitalSource:string;
 capital:{equityUsd:number|null;cashUsd:number|null;settledCashUsd:number|null;
 buyingPowerUsd:number|null;reservedCashUsd:number|null;};
 participantCount:number;participants:BotInstance[];researchContributors:Research[];
 postedFundingEventCount:number;unpostedFundingEventCount:number;
 capitalAccountVersion:number|null;brokerOrderAuthorized:boolean;
 blockers:string[];warnings:string[]};
type Registry={challenges:Challenge[];observedAt:string;brokerExecutionPermitted:false;};
type Entry={botInstanceId:string;legacyBotId:string};
const dollar=(value:number|null|undefined)=>value===null||value===undefined?
 "Unavailable":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const local=(iso:string)=>new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",
 timeZone:"America/Chicago",timeZoneName:"short"}).format(new Date(iso));
const slug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,78);
const cents=(input:string)=>/^\d{1,7}(?:\.\d{1,2})?$/.test(input.trim())?
 Number(input):null;
const source=(id:string)=>BOT_SOURCES.find(b=>b.id===id);
const defaultEntries=():Entry[]=>[];
function initialEntries(bot:BotInstance[]):Entry[]{
 return bot.map(x=>({botInstanceId:x.botInstanceId,legacyBotId:x.legacySourceBotId??""}))
   .filter(x=>Boolean(source(x.legacyBotId)));
}
function addEntry(items:Entry[],bot:BotSource):Entry[]{
 if(items.length>=16)return items;
 let i=1,instance="";
 do{instance=bot.short+"-"+String(i++).padStart(2,"0");}
 while(items.some(x=>x.botInstanceId===instance));
 return [...items,{botInstanceId:instance,legacyBotId:bot.id}];
}
export default function PaperChallengeManager(){
 const [registry,setRegistry]=useState<Registry|null>(null);
 const [selectedId,setSelectedId]=useState("shared-paper-v1");
 const [tab,setTab]=useState<"create"|"manage">("manage");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [name,setName]=useState("");
 const [id,setId]=useState("");
 const [starting,setStarting]=useState("5000");
 const [entries,setEntries]=useState<Entry[]>(defaultEntries);
 const [contributors,setContributors]=useState<string[]>([]);
 const [fundType,setFundType]=useState<"deposit"|"withdrawal">("deposit");
 const [fundAmount,setFundAmount]=useState("");
 const [reason,setReason]=useState("");
 const fundingKey=useRef<string|null>(null);
 const challenge=registry?.challenges.find(c=>c.challengeId===selectedId);
 const independent=challenge?.capitalSource==="standalone-shadow";
 const refresh=useCallback(async()=>{
  try{
   const res=await fetch("/api/paper-trading/bots/challenges/owner",
    {method:"GET",credentials:"same-origin",cache:"no-store"});
   const data=await res.json() as Registry&{error?:string};
   if(!res.ok||!Array.isArray(data.challenges))
     throw Error(data.error||"Could not load challenges.");
   setRegistry(data);
   setSelectedId(old=>data.challenges.some(x=>x.challengeId===old)?old:
     (data.challenges[0]?.challengeId??""));
  }catch(e){setError(e instanceof Error?e.message:"Unable to load challenge registry.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const manageSelect=(idValue:string)=>{
   const next=registry?.challenges.find(x=>x.challengeId===idValue);
   setSelectedId(idValue);setTab("manage");setError("");setNotice("");
   setEntries(initialEntries(next?.participants??[]));
   setContributors(next?.researchContributors.map(x=>x.contributorId)??[]);
   fundingKey.current=null;
 };
 const beginCreate=()=>{
   setTab("create");setName("");setId("");setStarting("5000");
   setEntries([]);setContributors([]);setError("");setNotice("");
 };
 const send=async(body:unknown)=>{
   setBusy(true);setError("");setNotice("");
   try{
    const res=await fetch("/api/paper-trading/bots/challenges/owner",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    });
    const data=await res.json() as {error?:string;result?:{challengeId?:string}};
    if(!res.ok||!data.result)throw Error(data.error||"Change rejected.");
    await refresh();
    setNotice("Change saved in the independent PAPER shadow ledger. No broker trade was placed.");
    return true;
   }catch(e){setError(e instanceof Error?e.message:"Change rejected.");return false;}
   finally{setBusy(false);}
 };
 const validateEntries=()=>entries.length>0&&entries.length<=16;
 const create=async(e:React.FormEvent)=>{
   e.preventDefault();
   const capital=cents(starting);
   if(!capital||capital>1_000_000||!validateEntries()){
     setError("Enter valid USD capital (up to $1,000,000) and select 1–16 bot instances.");return;
   }
   const challengeId=id.trim()||slug(name);
   if(!/^[a-z0-9][a-z0-9_-]{1,95}$/.test(challengeId)){
     setError("Choose a valid lowercase challenge ID.");return;
   }
   const ok=await send({action:"create",challengeId,displayName:name.trim(),
     startingCapitalUsd:capital,policyId:"shared-paper-capital-v1",
     botInstances:entries,researchContributors:contributors});
   if(ok){setSelectedId(challengeId);setTab("manage");}
 };
 const configure=async(lifecycle:string)=>{
   if(!challenge||!independent||!challenge.capitalAccountVersion)return;
   if(lifecycle==="archived"&&!window.confirm("Archive this shadow challenge? Archived challenges cannot be reopened."))return;
   if(!validateEntries()){setError("Keep 1–16 trading instances.");return;}
   await send({action:"configure",challengeId:challenge.challengeId,
     expectedVersion:challenge.capitalAccountVersion,lifecycle,
     botInstances:entries,researchContributors:contributors});
 };
 const fund=async(e:React.FormEvent)=>{
   e.preventDefault();
   if(!challenge||!independent||!challenge.capitalAccountVersion)return;
   const amount=cents(fundAmount);
   if(!amount||amount>1_000_000||reason.trim().length<4){
     setError("Enter a positive USD amount (max $1,000,000) and a reason (4+ characters).");return;
   }
   const delta=fundType==="deposit"?amount:-amount;
   if(fundType==="withdrawal"&&amount>(challenge.capital.cashUsd??0)){
     setError("Withdrawal exceeds recorded shadow cash.");return;
   }
   if(!window.confirm(`${fundType==="deposit"?"Add":"Remove"} ${dollar(amount)} of simulated capital in ${challenge.displayName}? This does not transfer broker funds.`))return;
   if(!fundingKey.current)fundingKey.current="ui-"+crypto.randomUUID();
   const ok=await send({action:"fund",challengeId:challenge.challengeId,
     expectedVersion:challenge.capitalAccountVersion,eventKey:fundingKey.current,
     amountDeltaUsd:delta,reason:reason.trim(),evidence:{source:"owner-challenge-manager-v1"}});
   if(ok){fundingKey.current=null;setFundAmount("");setReason("");}
 };
 const editEntry=(which:BotSource,plus:boolean)=>{
   setEntries(old=>{
     if(plus)return addEntry(old,which);
     const index=old.findLastIndex(x=>x.legacyBotId===which.id);
     return index<0?old:old.filter((_,i)=>i!==index);
   });
 };
 const toggleResearch=(idValue:string)=>{
   setContributors(old=>old.includes(idValue)?old.filter(x=>x!==idValue):[...old,idValue]);
 };
 const editor=<div className={styles.editor}>
   <h3>Trading bot lineup <small>{entries.length}/16 instances</small></h3>
   <p className={styles.help}>Each instance evaluates its strategy under this challenge. Adding two copies does not create additional cash or broker authority.</p>
   <div className={styles.botGrid}>{BOT_SOURCES.map(bot=>{
     const count=entries.filter(x=>x.legacyBotId===bot.id).length;
     return <div key={bot.id} className={styles.botRow}>
       <div><strong>{bot.name}</strong><small>{bot.detail}</small></div>
       <div className={styles.stepper}>
         <button type="button" disabled={busy||count===0} onClick={()=>editEntry(bot,false)}
            aria-label={`Remove ${bot.name} instance`}>−</button>
         <span aria-live="polite">{count}</span>
         <button type="button" disabled={busy||entries.length>=16||count>=4}
            onClick={()=>editEntry(bot,true)} aria-label={`Add ${bot.name} instance`}>+</button>
       </div>
     </div>;
   })}</div>
   <h3>Research contributors</h3>
   <div className={styles.research}>
     {(["catalog","midas"] as const).map(x=><label key={x}>
       <input type="checkbox" checked={contributors.includes(x)}
         disabled={busy} onChange={()=>toggleResearch(x)}/>
       <span><strong>{x==="catalog"?"Catalog":"Midas"}</strong><small>Research only • No order authority</small></span>
     </label>)}
   </div>
 </div>;
 return <div className={styles.shell}>
   <header className={styles.hero}>
     <div className={styles.kicker}>CREATORHUB / BIGORDERS · PAPER ONLY</div>
     <h1>Challenge Manager</h1>
     <p>Build independent simulated portfolios, combine the bots, and compare their capital. No challenge here is allowed to place Alpaca broker orders.</p>
     <div className={styles.headerLinks}>
       <Link href="/paper-trading/bots">← Bot Lab</Link>
       <Link href="/paper-trading/bots/performance">Performance audit ↗</Link>
       <button type="button" disabled={busy} onClick={()=>void refresh()}>↻ Refresh</button>
     </div>
   </header>
   <div className={styles.safety} role="status">Shadow only <span>•</span> No real money <span>•</span> No PAPER broker execution <span>•</span> Separate historical $100 ledgers</div>
   {error&&<div className={styles.error} role="alert">{error}</div>}
   {notice&&<div className={styles.success} role="status">{notice}</div>}
   {loading?<p>Loading owner challenges…</p>:<>
     <div className={styles.layout}>
       <aside className={styles.sidebar}>
         <div className={styles.sectionTop}><h2>Portfolios</h2><span>{registry?.challenges.length??0}</span></div>
         {registry?.challenges.map(c=><button type="button" key={c.challengeId}
            className={selectedId===c.challengeId&&tab==="manage"?styles.selectedCard:styles.challengeCard}
            onClick={()=>manageSelect(c.challengeId)}>
           <div className={styles.cardTop}><strong>{c.displayName}</strong><span>{c.lifecycle}</span></div>
           <div className={styles.cardValue}>{dollar(c.capital.equityUsd)}</div>
           <small>{c.participantCount} trading instance{c.participantCount===1?"":"s"} · {c.capitalSource==="standalone-shadow"?"Independent shadow":"Linked legacy preview"}</small>
         </button>)}
         <button type="button" onClick={beginCreate} className={styles.newButton}>+ New PAPER challenge</button>
         <div className={styles.sideNote}>Each virtual portfolio is separate. Balances here are not pooled with the original bot accounts.</div>
       </aside>
       <main className={styles.main}>
         {tab==="create"?<section className={styles.panel}>
           <div className={styles.sectionTop}><h2>New shadow challenge</h2><span>Setup</span></div>
           <form onSubmit={create}>
             <div className={styles.two}>
               <label className={styles.field}>Challenge name<input required maxLength={120}
                 placeholder="Spark + Midas Experiment" value={name}
                 disabled={busy} onChange={e=>{setName(e.target.value);setId(slug(e.target.value));}}/></label>
               <label className={styles.field}>Challenge ID<input required maxLength={96}
                 placeholder="spark-midas-experiment" value={id}
                 disabled={busy} onChange={e=>setId(e.target.value)}/></label>
             </div>
             <label className={styles.field}>Starting virtual capital (USD)
               <input required type="number" step="0.01" min="0.01" max="1000000"
                 value={starting} disabled={busy} onChange={e=>setStarting(e.target.value)}/>
             </label>
             {editor}
             <div className={styles.actions}><button className={styles.primary}
               disabled={busy||!name.trim()||!validateEntries()} type="submit">{busy?"Saving…":"Create shadow challenge"}</button></div>
           </form>
         </section>:challenge?<div className={styles.stack}>
           <section className={styles.panel}>
             <div className={styles.sectionTop}><div><div className={styles.kicker}>{challenge.challengeId}</div>
               <h2>{challenge.displayName}</h2></div><span>{challenge.lifecycle}</span></div>
             <div className={styles.metrics}>
               <div><small>Virtual equity</small><strong>{dollar(challenge.capital.equityUsd)}</strong></div>
               <div><small>Available cash</small><strong>{dollar(challenge.capital.cashUsd)}</strong></div>
               <div><small>Reserved cash</small><strong>{dollar(challenge.capital.reservedCashUsd)}</strong></div>
               <div><small>Starting capital</small><strong>{dollar(challenge.startingCapitalUsd)}</strong></div>
             </div>
             <div className={styles.inlineFacts}>
               <span>{challenge.participantCount} bot instances</span>
               <span>{challenge.researchContributors.length} researchers</span>
               <span>Account v{challenge.capitalAccountVersion??"?"}</span>
               <span>{challenge.postedFundingEventCount} posted funding records</span>
             </div>
             {(challenge.blockers.length>0||challenge.warnings.length>0)&&
             <div className={styles.alert}>
               {challenge.blockers.map((x,i)=><p key={i}>Blocking: {x}</p>)}
               {challenge.warnings.map((x,i)=><p key={i}>Notice: {x}</p>)}
             </div>}
             {!independent&&<p className={styles.help}>This is the original linked $5,000 preview. Its balance remains authoritative in the shared scenario. Changes and funding are intentionally disabled here.</p>}
             <div className={styles.metadata}>As of {registry?.observedAt?local(registry.observedAt):"unknown"} · Broker execution disabled</div>
           </section>
           {independent?<section className={styles.panel}>
             <div className={styles.sectionTop}><h2>Configure this challenge</h2><span>Versioned changes</span></div>
             {editor}
             <div className={styles.actions}>
               <button type="button" disabled={busy} className={styles.primary}
                 onClick={()=>void configure(challenge.lifecycle)}>Save lineup</button>
               {challenge.lifecycle==="preview"?
                 <button type="button" disabled={busy} onClick={()=>void configure("paused")}>Pause</button>:
               challenge.lifecycle==="paused"?
                 <button type="button" disabled={busy} onClick={()=>void configure("preview")}>Resume preview</button>:null}
               {challenge.lifecycle!=="archived"&&<button type="button"
                 disabled={busy} className={styles.danger} onClick={()=>void configure("archived")}>Archive</button>}
             </div>
           </section>:<section className={styles.panel}>
             <h2>Registered strategy identities</h2>
             <div className={styles.chips}>{challenge.participants.map(x=>
               <span key={x.botInstanceId}>{x.botInstanceId} · {source(x.legacySourceBotId??"")?.name??x.strategyId}</span>)}</div>
             <p className={styles.help}>Catalog and Midas are optional research contributors to future challenges; they are never order-placement bots.</p>
           </section>}
           {independent&&challenge.lifecycle!=="archived"&&<section className={styles.panel}>
             <div className={styles.sectionTop}><h2>Virtual funding</h2><span>Simulated dollars</span></div>
             <p className={styles.help}>Deposits and withdrawals update only this independent challenge&apos;s virtual accounting ledger. Every successful change gets an immutable funding receipt. This does not transfer funds to or from Alpaca.</p>
             <form onSubmit={fund}>
               <fieldset className={styles.fundingChoice}>
                 <legend>Action</legend>
                 <label><input type="radio" checked={fundType==="deposit"} disabled={busy}
                   onChange={()=>{setFundType("deposit");fundingKey.current=null;}}/> Deposit</label>
                 <label><input type="radio" checked={fundType==="withdrawal"} disabled={busy}
                   onChange={()=>{setFundType("withdrawal");fundingKey.current=null;}}/> Withdraw</label>
               </fieldset>
               <div className={styles.two}>
                 <label className={styles.field}>Amount in USD
                   <input required type="number" min="0.01" max="1000000" step="0.01"
                     value={fundAmount} disabled={busy}
                     onChange={e=>{setFundAmount(e.target.value);fundingKey.current=null;}}/></label>
                 <label className={styles.field}>Reason
                   <input required minLength={4} maxLength={500}
                     placeholder="Research budget adjustment" value={reason} disabled={busy}
                     onChange={e=>{setReason(e.target.value);fundingKey.current=null;}}/></label>
               </div>
               <button type="submit" className={styles.primary} disabled={busy||!fundAmount||reason.trim().length<4}>
                 {busy?"Recording…":fundType==="deposit"?"Record virtual deposit":"Record virtual withdrawal"}
               </button>
             </form>
           </section>}
         </div>:<div className={styles.panel}><h2>No challenge selected</h2><p>Create a challenge to get started.</p></div>}
       </main>
     </div>
   </>}
 </div>;
}
