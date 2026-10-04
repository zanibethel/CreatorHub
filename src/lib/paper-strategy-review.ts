export type StrategyReviewJournalRow = {
  bot_id: string;
  event_type: string;
  symbol: string | null;
  occurred_at: string;
  score: number | null;
  qualification: string | null;
  regime: string | null;
  blockers: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
};

export type StrategyReviewTrade = {
  bot_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  symbol: string;
  status: "open" | "closing" | "closed";
  opened_at: string;
  closed_at: string | null;
  realized_pl: number | null;
  r_multiple: number | null;
  mfe_r: number;
  mae_r: number;
  estimated_fees: number | null;
  exit_reason: string | null;
};

export type StrategyReviewCounterfactual = {
  bot_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  symbol: string;
  status: "watching" | "triggered" | "completed" | "expired" | "ambiguous" | "superseded";
  source_event_type: string;
  decision_at: string;
  score: number | null;
  first_outcome: string | null;
  mfe_r: number;
  mae_r: number;
};

export type StrategyReviewLedger = {
  bot_id: string;
  display_name: string;
  strategy_id: string | null;
  strategy_version: number | null;
  status: string;
};

type Recommendation = {
  id: string;
  severity: "info" | "review";
  title: string;
  rationale: string;
  evidenceCount: number;
  advisoryOnly: true;
  requiresNewStrategyVersion: true;
  paperValidationRequired: true;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum,value) => sum + value,0) / values.length : null;

const pct = (part: number, total: number) => total > 0 ? (part / total) * 100 : null;

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

function scoreBand(score: number) {
  if (score < 60) return "0-59";
  if (score < 70) return "60-69";
  if (score < 80) return "70-79";
  return "80-100";
}

function topReasons(rows: StrategyReviewJournalRow[], limit = 5) {
  const counts = new Map<string,number>();
  for (const row of rows) {
    for (const reason of [...row.blockers,...row.warnings]) {
      const clean = reason.trim();
      if (!clean) continue;
      counts.set(clean,(counts.get(clean) ?? 0)+1);
    }
  }
  return [...counts.entries()]
    .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0,limit)
    .map(([reason,count])=>({reason,count}));
}

function maturity(resolved: number) {
  if (resolved < 20) return { level:"collecting" as const, minimumForRecommendations:20 };
  if (resolved < 50) return { level:"early" as const, minimumForRecommendations:20 };
  if (resolved < 100) return { level:"developing" as const, minimumForRecommendations:20 };
  return { level:"established" as const, minimumForRecommendations:20 };
}

function classifyCounterfactual(outcome: string | null) {
  if (outcome === "two-r-before-stop") return "missed-opportunity";
  if (outcome === "stop-before-one-r") return "protective-rejection";
  if (outcome === "stop-after-one-r" || outcome === "one-r-then-session-end") return "mixed";
  if (outcome === "never-triggered") return "never-triggered";
  if (outcome?.includes("same-bar")) return "ambiguous";
  return "other";
}

export function buildPaperStrategyReview(input: {
  collectedAt: string;
  ledgers: StrategyReviewLedger[];
  journal: StrategyReviewJournalRow[];
  trades: StrategyReviewTrade[];
  counterfactuals: StrategyReviewCounterfactual[];
}) {
  const bots = input.ledgers.map(ledger => {
    const journal = input.journal.filter(row => row.bot_id === ledger.bot_id);
    const executionJournal = journal.filter(row => row.metadata.executionEligible !== false);
    const monitorOnlyJournal = journal.filter(row => row.metadata.executionEligible === false);
    const trades = input.trades.filter(row => row.bot_id === ledger.bot_id);
    const counterfactuals = input.counterfactuals.filter(row => row.bot_id === ledger.bot_id);
    const closedTrades = trades.filter(row => row.status === "closed");
    const closedWithR = closedTrades.filter(row => finite(row.r_multiple));
    const terminalCounterfactuals = counterfactuals.filter(row =>
      ["completed","expired","ambiguous","superseded"].includes(row.status)
    );
    const analyzableCounterfactuals = terminalCounterfactuals.filter(row =>
      row.first_outcome !== null && classifyCounterfactual(row.first_outcome) !== "ambiguous"
    );

    const missedOpportunities = analyzableCounterfactuals.filter(row =>
      classifyCounterfactual(row.first_outcome) === "missed-opportunity"
    ).length;
    const protectiveRejections = analyzableCounterfactuals.filter(row =>
      classifyCounterfactual(row.first_outcome) === "protective-rejection"
    ).length;
    const mixedCounterfactuals = analyzableCounterfactuals.filter(row =>
      classifyCounterfactual(row.first_outcome) === "mixed"
    ).length;
    const neverTriggered = analyzableCounterfactuals.filter(row =>
      classifyCounterfactual(row.first_outcome) === "never-triggered"
    ).length;

    const outcomeEvidenceCount = closedWithR.length + analyzableCounterfactuals.length;
    const evidenceMaturity = maturity(outcomeEvidenceCount);

    const scoreBands = ["0-59","60-69","70-79","80-100"].map(band => {
      const observations = executionJournal.filter(row => finite(row.score) && scoreBand(row.score) === band);
      const studies = analyzableCounterfactuals.filter(row => finite(row.score) && scoreBand(row.score) === band);
      const favorable = studies.filter(row => classifyCounterfactual(row.first_outcome) === "missed-opportunity").length;
      const protective = studies.filter(row => classifyCounterfactual(row.first_outcome) === "protective-rejection").length;
      return {
        band,
        observations: observations.length,
        averageObservedScore: mean(observations.map(row => row.score!).filter(finite)),
        resolvedStudies: studies.length,
        missedOpportunityRatePct: pct(favorable,studies.length),
        protectiveRejectionRatePct: pct(protective,studies.length),
      };
    });

    const symbols = [...new Set([
      ...journal.map(row => row.symbol).filter((value): value is string => Boolean(value)),
      ...trades.map(row => row.symbol),
      ...counterfactuals.map(row => row.symbol),
    ])].map(symbol => {
      const observations = journal.filter(row => row.symbol === symbol);
      const closed = closedWithR.filter(row => row.symbol === symbol);
      const studies = analyzableCounterfactuals.filter(row => row.symbol === symbol);
      return {
        symbol,
        observations: observations.length,
        averageScore: mean(observations.map(row => row.score).filter(finite)),
        maxScore: observations.map(row => row.score).filter(finite).reduce<number | null>((max,value) => max === null ? value : Math.max(max,value),null),
        closedTrades: closed.length,
        averageExecutedR: mean(closed.map(row => row.r_multiple!).filter(finite)),
        resolvedCounterfactuals: studies.length,
        missedOpportunities: studies.filter(row => classifyCounterfactual(row.first_outcome) === "missed-opportunity").length,
        protectiveRejections: studies.filter(row => classifyCounterfactual(row.first_outcome) === "protective-rejection").length,
      };
    }).sort((a,b)=>b.observations-a.observations || a.symbol.localeCompare(b.symbol));

    const recommendations: Recommendation[] = [];
    if (outcomeEvidenceCount < evidenceMaturity.minimumForRecommendations) {
      recommendations.push({
        id:"collect-more-evidence",
        severity:"info",
        title:"Keep collecting PAPER evidence",
        rationale:`Only ${outcomeEvidenceCount} resolved outcome samples are available. Parameter changes are intentionally withheld until at least ${evidenceMaturity.minimumForRecommendations} resolved outcomes exist.`,
        evidenceCount:outcomeEvidenceCount,
        advisoryOnly:true,
        requiresNewStrategyVersion:true,
        paperValidationRequired:true,
      });
    } else {
      const cfResolved = analyzableCounterfactuals.length;
      const missRate = pct(missedOpportunities,cfResolved);
      const protectRate = pct(protectiveRejections,cfResolved);

      if (cfResolved >= 10 && missRate !== null && missRate >= 60 && (protectRate ?? 0) < 30) {
        const dominant = topReasons(executionJournal,1)[0]?.reason ?? "current entry gates";
        recommendations.push({
          id:"review-rejection-gates",
          severity:"review",
          title:"Review the most restrictive entry gate",
          rationale:`${missRate.toFixed(0)}% of ${cfResolved} analyzable non-executed studies reached +2R before the original stop. Compare that evidence against the dominant blocker: ${dominant}.`,
          evidenceCount:cfResolved,
          advisoryOnly:true,
          requiresNewStrategyVersion:true,
          paperValidationRequired:true,
        });
      }

      if (cfResolved >= 10 && protectRate !== null && protectRate >= 60) {
        recommendations.push({
          id:"retain-protective-gates",
          severity:"info",
          title:"Current rejection gates appear protective",
          rationale:`${protectRate.toFixed(0)}% of ${cfResolved} analyzable non-executed studies hit the original stop before +1R. Do not loosen gates without stronger contradictory evidence.`,
          evidenceCount:cfResolved,
          advisoryOnly:true,
          requiresNewStrategyVersion:true,
          paperValidationRequired:true,
        });
      }

      if (closedWithR.length >= 10) {
        const averageR = mean(closedWithR.map(row => row.r_multiple!).filter(finite));
        const averageMfeR = mean(closedWithR.map(row => row.mfe_r).filter(finite));
        if (averageR !== null && averageMfeR !== null && averageR < 0.25 && averageMfeR >= 1.25) {
          recommendations.push({
            id:"review-profit-capture",
            severity:"review",
            title:"Review profit-capture rules",
            rationale:`Closed trades averaged ${averageMfeR.toFixed(2)}R MFE but only ${averageR.toFixed(2)}R realized. Test a new exit version rather than changing the current strategy in place.`,
            evidenceCount:closedWithR.length,
            advisoryOnly:true,
            requiresNewStrategyVersion:true,
            paperValidationRequired:true,
          });
        }
      }

      if (!recommendations.length) {
        recommendations.push({
          id:"no-change-supported",
          severity:"info",
          title:"No strategy change is supported yet",
          rationale:"The current evidence does not show a strong enough pattern to justify a versioned parameter change.",
          evidenceCount:outcomeEvidenceCount,
          advisoryOnly:true,
          requiresNewStrategyVersion:true,
          paperValidationRequired:true,
        });
      }
    }

    const brokerRejected = journal.filter(row =>
      row.event_type === "rejected" && row.metadata.lifecycleSource === "broker-reconciliation"
    ).length;
    const strategyRejected = journal.filter(row =>
      row.event_type === "rejected" && row.metadata.lifecycleSource !== "broker-reconciliation"
    ).length;

    return {
      botId:ledger.bot_id,
      displayName:ledger.display_name,
      strategyId:ledger.strategy_id,
      strategyVersion:ledger.strategy_version,
      status:ledger.status,
      evidenceMaturity:{
        ...evidenceMaturity,
        resolvedOutcomeSamples:outcomeEvidenceCount,
      },
      executed:{
        openTrades:trades.filter(row=>row.status !== "closed").length,
        closedTrades:closedTrades.length,
        closedTradesWithR:closedWithR.length,
        averageR:mean(closedWithR.map(row=>row.r_multiple!).filter(finite)),
        winRatePct:pct(closedWithR.filter(row=>row.r_multiple! > 0).length,closedWithR.length),
        totalRealizedPl:closedTrades.reduce((sum,row)=>sum+(row.realized_pl ?? 0),0),
        totalEstimatedFees:closedTrades.reduce((sum,row)=>sum+(row.estimated_fees ?? 0),0),
        averageMfeR:mean(closedTrades.map(row=>row.mfe_r).filter(finite)),
        averageMaeR:mean(closedTrades.map(row=>row.mae_r).filter(finite)),
      },
      counterfactual:{
        total:counterfactuals.length,
        active:counterfactuals.filter(row=>["watching","triggered"].includes(row.status)).length,
        terminal:terminalCounterfactuals.length,
        analyzable:analyzableCounterfactuals.length,
        missedOpportunities,
        protectiveRejections,
        mixed:mixedCounterfactuals,
        neverTriggered,
        ambiguous:terminalCounterfactuals.filter(row=>classifyCounterfactual(row.first_outcome)==="ambiguous" || row.status==="ambiguous").length,
        averageMfeR:mean(analyzableCounterfactuals.map(row=>row.mfe_r).filter(finite)),
        averageMaeR:mean(analyzableCounterfactuals.map(row=>row.mae_r).filter(finite)),
      },
      decisions:{
        observations:journal.length,
        executionRelevantObservations:executionJournal.length,
        monitorOnlyObservations:monitorOnlyJournal.length,
        candidateEvents:journal.filter(row=>row.event_type==="candidate").length,
        authorizedEvents:journal.filter(row=>row.event_type==="authorized").length,
        strategyRejectedEvents:strategyRejected,
        brokerRejectedEvents:brokerRejected,
        canceledEvents:journal.filter(row=>row.event_type==="canceled").length,
        expiredEvents:journal.filter(row=>row.event_type==="expired").length,
        replacedEvents:journal.filter(row=>row.event_type==="replaced").length,
        executionErrors:journal.filter(row=>row.event_type==="execution_error").length,
        topReasons:topReasons(executionJournal),
      },
      scoreBands,
      symbols,
      recommendations,
    };
  });

  return {
    collectedAt:input.collectedAt,
    policy:{
      advisoryOnly:true,
      automaticStrategyMutation:false,
      automaticRiskIncrease:false,
      liveMoneyChangesAllowed:false,
      minimumResolvedOutcomesForRecommendations:20,
      materialChangesRequireNewStrategyVersion:true,
      paperValidationRequired:true,
      counterfactualsAreNotPnL:true,
    },
    bots,
  };
}
