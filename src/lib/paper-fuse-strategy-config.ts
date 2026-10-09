/** Research thresholds remain fixed; a single PAPER pilot executor is implemented but default and production ledger switches remain OFF. */
export const FUSE_PENNY_STRATEGY_V1 = {
  id:"penny-volatility-day-v1",version:1,botProfileId:"penny-volatility-day-100",brokerTag:"pny",
  mode:"research-only",execution:{paperOnly:true,executionEnabledByDefault:false,submissionsImplemented:true},
  intake:{minimumPriceUsd:0.08,maximumPriceUsd:5,minimumScannerVersion:3,maximumProspectAgeMinutes:20},
  market:{maximumQuoteAgeSeconds:90,maximumBarLagMinutes:12,minimumCompleted5mBars:8,
    maximumSpreadPct:1.5,maximumSpreadUnderOnePct:2.0,minimumRecentDollarVolume:25_000},
  setup:{volumeBaselineBars:6,breakoutLookbackBars:4,breakoutBufferPct:0.1,
    minimumRelativeVolume:1.5,minimumMomentumPct:0.4,maximumMomentumPct:4.5,
    minimumAtrPct:0.3,maximumAtrPct:6,maximumSessionGainPct:12,maximumChasePct:1.25},
  scoring:{prepareScore:65,readyScore:80},
  session:{timezone:"America/New_York",openingWaitMinutes:10,stopEntriesMinutesBeforeClose:45,flattenMinutesBeforeClose:15},
  risk:{riskPerTradePct:0.5,maximumAllocationPct:20,maximumOpenRiskPct:1,maximumDailyLossPct:1.5,
    maximumOpenPositions:1,maximumEntriesPerDay:3,minimumStopPct:1,maximumStopPct:5,
    defaultStopPct:3,atrStopMultiplier:1.25},
} as const;
