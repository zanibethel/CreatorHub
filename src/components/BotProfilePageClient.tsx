"use client";

import Link from "next/link";
import { PAPER_BOT_PROFILES } from "@/lib/paper-bot-profiles";
import PaperSignalPipeline from "./PaperSignalPipeline";
import FuseResearchPanel from "./FuseResearchPanel";
import usePaperBotLedgers from "./usePaperBotLedgers";
import usePaperProspects, { type PaperProspect } from "./usePaperProspects";
import usePaperSignalDesk from "./usePaperSignalDesk";
import useMarketMonitor from "./useMarketMonitor";
import styles from "./PaperTradingLab.module.css";

const TERMINAL_ORDER_STATUSES=new Set(["filled","canceled","cancelled","rejected","expired","replaced","closed","done_for_day"]);
const money=(value:number|null|undefined)=>value==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const signedMoney=(value:number|null|undefined)=>value==null?"—":`${value>=0?"+":""}${money(value)}`;
const normalized=(value:string)=>value.replace("/","-").toUpperCase();
const mid=(bid:number|null|undefined,ask:number|null|undefined)=>bid!=null&&ask!=null&&bid>0&&ask>0?(bid+ask)/2:bid??ask??null;

function DetailList({title,items}:{title:string;items:string[]}){
  return <section className={styles.botProfileList}>
    <h3>{title}</h3>
    <ul>{items.map(item=><li key={item}>{item}</li>)}</ul>
  </section>;
}

export default function BotProfilePageClient({botId}:{botId:string}){
  const profile=PAPER_BOT_PROFILES.find(item=>item.id===botId);
  const {report:ledgers,error:ledgerError,refresh:refreshLedgers}=usePaperBotLedgers();
  const {report:prospects,error:prospectError}=usePaperProspects();
  const {report:signalDesk,error:signalError,refresh:refreshSignals}=usePaperSignalDesk();

  const assigned=prospects?.prospects.filter(row=>row.assigned_bot_ids.includes(botId))??[];
  const stockSymbols=[...new Set(assigned.filter(row=>row.asset_class==="stock").map(row=>row.symbol))].slice(0,30).join(",");
  const cryptoSymbols=[...new Set(assigned.filter(row=>row.asset_class==="crypto").map(row=>normalized(row.symbol)))].slice(0,15).join(",");
  const {snapshot:market,error:marketError,refresh:refreshMarket}=useMarketMonitor(stockSymbols,cryptoSymbols,Boolean(stockSymbols||cryptoSymbols));

  if(!profile)return <main className={styles.botLab}><div className={styles.portfolioWarnings}><span>Unknown bot profile.</span></div></main>;

  const ledger=ledgers?.bots.find(bot=>bot.botId===botId);
  const automationEnabled=ledger?.executionEnabled===true;
  const executionStatusKnown=Boolean(ledger)||profile.executionState==="planned";
  const executionBadge=!executionStatusKnown
    ? ledgerError?"EXECUTION STATUS UNAVAILABLE":"CHECKING EXECUTION STATUS"
    : automationEnabled?"AUTOMATIC SIMULATION":profile.executionState==="planned"?"PLANNED":"RESEARCH / EVIDENCE";
  const staged=ledgers?.stagedOrders?.[botId]??[];
  const brokerOrders=(ledgers?.brokerOrders?.[botId]??[]).filter(order=>!TERMINAL_ORDER_STATUSES.has(order.status.toLowerCase()));
  const positions=ledgers?.positionPlans?.[botId]??[];
  const trades=ledgers?.tradeMetrics?.[botId]??[];
  const counterfactuals=ledgers?.counterfactuals?.[botId]??[];
  const intakeEvents=signalDesk?.events?.[botId]??[];
  const closed=trades.filter(item=>item.status==="closed");
  const wins=closed.filter(item=>(item.realized_pl??0)>0).length;
  const losses=closed.filter(item=>(item.realized_pl??0)<0).length;
  const avgR=closed.length?closed.reduce((sum,item)=>sum+(item.r_multiple??0),0)/closed.length:null;
  const currentPriceFor=(row:PaperProspect)=>{
    if(row.asset_class==="stock"){
      const quote=market?.stocks[row.symbol];
      return quote?mid(quote.bid,quote.ask):row.price;
    }
    const quote=market?.crypto.find(item=>normalized(item.product)===normalized(row.symbol));
    return quote?mid(quote.bestBid?.price,quote.bestAsk?.price):row.price;
  };
  const errors=[ledgerError,prospectError,signalError,marketError].filter(Boolean);
  const refresh=()=>{refreshLedgers();refreshSignals();refreshMarket();};

  return <main className={styles.botLab}>
    <header className={styles.botLabHeader}>
      <div>
        <Link href="/paper-trading/bots">← Bot Lab</Link>
        <h1>{profile.codename??profile.name}</h1>
        <p>{profile.role??profile.style}</p>
      </div>
      <div className={styles.botLabActions}>
        <Link href="/paper-trading/signals">Signal Desk</Link>
        <button type="button" onClick={refresh}>Refresh</button>
      </div>
    </header>

    <section className={styles.botProfileHero}>
      <div className={styles.botProfileIdentity}>
        <span className={automationEnabled?styles.botStatusActive:styles.portfolioBadge}>
          {executionBadge}
        </span>
        <h2>{profile.name}</h2>
        <p>{profile.mission??profile.style}</p>
        <div className={styles.botProfileTags}>
          <span>{profile.holdingPeriod??profile.cadence.description}</span>
          {profile.universe.assetClasses.map(asset=><span key={asset}>{asset.toUpperCase()}</span>)}
          <span>$100 isolated ledger</span>
        </div>
      </div>
      <div className={styles.botProfileBalance}>
        <span>Virtual equity</span>
        <strong>{money(ledger?.equity??profile.challengeStartingCash)}</strong>
        <small>{signedMoney(ledger?.realizedPl??0)} realized · {positions.length} open</small>
      </div>
    </section>

    <section className={styles.portfolioStats}>
      <div className={styles.portfolioStat}><span>Strategy</span><strong>{profile.strategyId??"Not armed"}</strong><small>{profile.tradePlan.source.replaceAll("-"," ")}</small></div>
      <div className={styles.portfolioStat}><span>Prospects</span><strong>{assigned.length}</strong><small>currently assigned</small></div>
      <div className={styles.portfolioStat}><span>Prepared</span><strong>{staged.length}</strong><small>planned entries</small></div>
      <div className={styles.portfolioStat}><span>Closed trades</span><strong>{closed.length}</strong><small>{wins} wins · {losses} losses</small></div>
      <div className={styles.portfolioStat}><span>Average R</span><strong>{avgR==null?"—":avgR.toFixed(2)}</strong><small>closed positions</small></div>
      <div className={styles.portfolioStat}><span>Counterfactuals</span><strong>{counterfactuals.length}</strong><small>tracked non-trades / setups</small></div>
    </section>

    {errors.length?<div className={styles.portfolioWarnings}>{errors.map((error,index)=><span key={index}>{error}</span>)}</div>:null}

    <section className={styles.botProfileGrid}>
      <DetailList title="What this bot hunts" items={profile.entrySignals??[profile.style]}/>
      <DetailList title="What makes it refuse" items={profile.refusesWhen??profile.notes}/>
      <DetailList title="Operating rules" items={[
        profile.cadence.description,
        `Universe: ${profile.universe.description}`,
        ...profile.notes.slice(0,2),
      ]}/>
    </section>

    {botId==="penny-volatility-day-100"?<FuseResearchPanel history={ledgers?.history?.[botId]??[]} refreshVersion={ledgers?.collectedAt?Date.parse(ledgers.collectedAt):0}/>:null}

    {executionStatusKnown?<PaperSignalPipeline
      botName={profile.codename??profile.name}
      automationEnabled={automationEnabled}
      prospects={assigned}
      stagedOrders={staged}
      brokerOrders={brokerOrders}
      positions={positions}
      intakeEvents={intakeEvents}
      currentPriceFor={currentPriceFor}
    />:<div className={styles.portfolioWarnings}><span>{ledgerError?"Live bot execution status could not be verified.":"Loading current bot execution status and evidence…"}</span></div>}

    <footer className={styles.portfolioFooter}>
      <span>{profile.codename??profile.name} uses its own isolated virtual ledger and risk budget.</span>
      <span>Live-money execution remains disabled across this proof of concept.</span>
    </footer>
  </main>;
}
