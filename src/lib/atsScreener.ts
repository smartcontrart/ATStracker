import { flattenTimeframeBaselines } from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  AtsState,
  AtsStateDetectionResult,
  BollingerBandPoint,
  DidiTarget,
  MacroTargetTP2,
  OHLCVBar,
  ScreenerResult,
  SetupConfirmationStatus,
  SetupDirection,
  Timeframe,
  TimeframeATSData,
  TimeframeHorizonSummary,
} from '../types/ats.ts';

/**
 * Knockout Rule tolerance: Didi must be breached by MORE than 1%
 * (`livePrice < Didi * 0.99` for Buy, `livePrice > Didi * 1.01` for Sell)
 * to return status `INVALIDATED`.
 */
export const DIDI_KNOCKOUT_BUFFER = 0.01;

export const ATS_STATE_SORT_PRIORITY: Record<AtsState, number> = {
  'STEP 2: REVERSAL CONFIRMED': 3,
  'STEP 1: THE WALL': 2,
  'NO SETUP': 1,
  INVALIDATED: 0,
};

export type ScreenerSortKey = 'STATE' | 'CLUSTER' | 'RISK';

export function compareScreenerResults(
  a: ScreenerResult,
  b: ScreenerResult,
  sortKey: ScreenerSortKey = 'STATE'
): number {
  if (sortKey === 'CLUSTER') {
    if (b.ClusterDensityCount !== a.ClusterDensityCount) {
      return b.ClusterDensityCount - a.ClusterDensityCount;
    }
    const stateDiff =
      ATS_STATE_SORT_PRIORITY[b.atsState] - ATS_STATE_SORT_PRIORITY[a.atsState];
    if (stateDiff !== 0) return stateDiff;
    return a.RiskToDidi - b.RiskToDidi;
  }

  if (sortKey === 'RISK') {
    const aActive =
      a.atsState === 'STEP 1: THE WALL' ||
      a.atsState === 'STEP 2: REVERSAL CONFIRMED';
    const bActive =
      b.atsState === 'STEP 1: THE WALL' ||
      b.atsState === 'STEP 2: REVERSAL CONFIRMED';
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (a.RiskToDidi !== b.RiskToDidi) return a.RiskToDidi - b.RiskToDidi;
    return b.ClusterDensityCount - a.ClusterDensityCount;
  }

  // Default: STATE -> ClusterDensityCount (desc) -> RiskToDidi (asc)
  const stateDiff =
    ATS_STATE_SORT_PRIORITY[b.atsState] - ATS_STATE_SORT_PRIORITY[a.atsState];
  if (stateDiff !== 0) return stateDiff;
  if (b.ClusterDensityCount !== a.ClusterDensityCount) {
    return b.ClusterDensityCount - a.ClusterDensityCount;
  }
  return a.RiskToDidi - b.RiskToDidi;
}

const SHORT_KEY_LABELS: Record<string, string> = {
  Jack_Minus1: 'Jack-1',
  Jack_0: 'Jack0',
  Jack_Plus1: 'Jack+1',
  Oggy_Minus1: 'Oggy-1',
  Oggy_0: 'Oggy0',
  Oggy_Plus1: 'Oggy+1',
};

const TIMEFRAME_ORDER_WEIGHT: Record<Timeframe, number> = {
  D: 0,
  W: 1,
  M: 2,
  '3M': 3,
  '6M': 4,
  '12M': 5,
};

function fmtNum(val: number, category: AssetCategory): string {
  if (category === 'forex') return val >= 50 ? val.toFixed(3) : val.toFixed(5);
  if (val < 1) return val.toFixed(5);
  if (val < 10) return val.toFixed(4);
  return val.toFixed(2);
}

function buildHorizonMatrix(
  timeframes: Record<Timeframe, TimeframeATSData>,
  livePrice: number
): Record<Timeframe, TimeframeHorizonSummary> {
  const matrix = {} as Record<Timeframe, TimeframeHorizonSummary>;

  for (const tf of ALL_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const allLines = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy, false);

    // Strictly exclude pierced lines (Green support > livePrice or Red resistance < livePrice)
    const unbrokenLines = allLines.filter(
      (l) =>
        !l.isPierced &&
        (l.polarity === 'GREEN' ? l.price <= livePrice : l.price >= livePrice)
    );
    const piercedCount = allLines.length - unbrokenLines.length;

    const greenLines: string[] = [];
    const redLines: string[] = [];
    let oggyCount = 0;
    const wallTouches: TimeframeHorizonSummary['wallTouches'] = [];

    for (const l of unbrokenLines) {
      const shortName = SHORT_KEY_LABELS[l.key] || l.key;
      if (l.family === 'Oggy') oggyCount++;
      if (l.polarity === 'GREEN') {
        greenLines.push(shortName);
      } else {
        redLines.push(shortName);
      }

      const absDistPct = (Math.abs(livePrice - l.price) / livePrice) * 100;
      if (absDistPct <= 1.0) {
        wallTouches.push({
          shortName,
          label: l.label,
          family: l.family,
          polarity: l.polarity,
          price: l.price,
          absDistancePct: absDistPct,
        });
      }
    }

    let bbState: TimeframeHorizonSummary['bbState'] = 'NA';
    if (tfData.latestBB) {
      if (tfData.oppositeBandCurvingInwards) bbState = 'CURVING_IN';
      else if (tfData.bbCompressing) bbState = 'COMPRESSING';
      else bbState = 'EXPANDING';
    }

    let sarState: TimeframeHorizonSummary['sarState'] = 'NA';
    if (tfData.latestSAR) {
      if (tfData.sarFlippedBullishRecently) sarState = 'BULL_FLIP';
      else if (tfData.sarFlippedBearishRecently) sarState = 'BEAR_FLIP';
      else sarState = tfData.latestSAR.isBullish ? 'BULL' : 'BEAR';
    }

    matrix[tf] = {
      timeframe: tf,
      greenCount: greenLines.length,
      redCount: redLines.length,
      oggyCount,
      piercedCount,
      greenLines,
      redLines,
      wallTouches,
      bbState,
      sarState,
      m7Price: tfData.latestSMA7?.value ?? null,
      m20Price: tfData.latestSMA20?.value ?? tfData.latestBB?.mid ?? null,
    };
  }

  return matrix;
}

/**
 * Core Chronological ATS State Detection Engine (`detectAtsSetup`):
 *
 * Evaluates an asset chronologically through:
 * - State A: "INVALIDATED" (Knockout Rule — livePrice breached established Didi by >1%)
 * - State B: "NO SETUP" (Volatility Gatekeeper — Check 1 Phase 2 diverging, Check 2 Outer Band push/exit, Check 3 <=1% HTF Cluster)
 * - State C: "STEP 1: THE WALL" (Aggressive — on cluster, Didi intact, opposite Daily BB still widening)
 * - State D: "STEP 2: REVERSAL CONFIRMED" (Conservative — on cluster, Didi intact, opposite Daily BB hooked inward)
 */
export function detectAtsSetup(assetData: {
  livePrice: number;
  timeframes: Record<Timeframe, TimeframeATSData>;
}): AtsStateDetectionResult {
  const { livePrice, timeframes } = assetData;

  // 1. Gather strictly UNBROKEN Higher-Timeframe (W, M, 3M, 6M, 12M) Jack & Oggy lines
  //    plus all raw HTF reference prices (to detect State A knockouts when a cluster was just broken!)
  const unbrokenBuyCluster: ATSBaseline[] = [];
  const unbrokenSellCluster: ATSBaseline[] = [];
  const allHtfPrices: number[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const allTfLines = flattenTimeframeBaselines(
      tfData.Jack,
      tfData.Oggy,
      false
    );
    for (const line of allTfLines) {
      allHtfPrices.push(line.price);
      if (line.isPierced) continue;

      // Critical Rule: Green support MUST NOT be above livePrice; Red resistance MUST NOT be below livePrice
      if (line.polarity === 'GREEN' && line.price <= livePrice) {
        if (Math.abs(livePrice - line.price) / livePrice <= 0.01) {
          unbrokenBuyCluster.push(line);
        }
      } else if (line.polarity === 'RED' && line.price >= livePrice) {
        if (Math.abs(line.price - livePrice) / livePrice <= 0.01) {
          unbrokenSellCluster.push(line);
        }
      }
    }
  }

  const sortCluster = (lines: ATSBaseline[]) =>
    [...lines].sort((a, b) => {
      const tfDiff =
        TIMEFRAME_ORDER_WEIGHT[b.timeframe] -
        TIMEFRAME_ORDER_WEIGHT[a.timeframe];
      if (tfDiff !== 0) return tfDiff;
      return Math.abs(livePrice - a.price) - Math.abs(livePrice - b.price);
    });

  const sortedBuyCluster = sortCluster(unbrokenBuyCluster);
  const sortedSellCluster = sortCluster(unbrokenSellCluster);

  // Select consistent Daily bars & Bollinger Bands (falling back cleanly in synthetic single-TF tests)
  const dBars = timeframes.D.bars;
  const dailyConsistent =
    dBars.length >= 2 &&
    Math.abs(dBars[dBars.length - 1].close - livePrice) <=
      Math.max(0.01, livePrice * 0.03);

  const fallbackTf: Timeframe =
    sortedBuyCluster[0]?.timeframe ??
    sortedSellCluster[0]?.timeframe ??
    'M';

  const evalBars: OHLCVBar[] = dailyConsistent
    ? dBars
    : timeframes[fallbackTf].bars;
  const evalBB: BollingerBandPoint[] = dailyConsistent
    ? timeframes.D.bollingerBands
    : timeframes[fallbackTf].bollingerBands;

  const currBB = evalBB.length >= 1 ? evalBB[evalBB.length - 1] : null;
  const prevBB = evalBB.length >= 2 ? evalBB[evalBB.length - 2] : null;
  const bbOffset = evalBars.length - evalBB.length;

  const getBBAtBarIndex = (barIdx: number): BollingerBandPoint | null => {
    const idx = barIdx - bbOffset;
    return idx >= 0 && idx < evalBB.length ? evalBB[idx] : currBB;
  };

  // =========================================================================
  // STATE A: "INVALIDATED" (The Knockout Rule — 1% Buffer beyond Didi)
  // =========================================================================
  const recentLen = Math.min(10, evalBars.length);
  const recentStartIdx = Math.max(0, evalBars.length - recentLen);
  const windowBars = evalBars.slice(recentStartIdx);

  // Determine whether recent market leg is dropping (lower half of BB) or rallying (upper half of BB)
  const isLowerHalf = currBB ? livePrice <= currBB.mid : true;

  // Trace current drop from highest high in window
  let peakOffset = 0;
  for (let i = 1; i < windowBars.length; i++) {
    if (windowBars[i].high > windowBars[peakOffset].high) {
      peakOffset = i;
    }
  }
  const dropBars = windowBars.slice(peakOffset);

  // Trace current rally from lowest low in window
  let troughOffset = 0;
  for (let i = 1; i < windowBars.length; i++) {
    if (windowBars[i].low < windowBars[troughOffset].low) {
      troughOffset = i;
    }
  }
  const rallyBars = windowBars.slice(troughOffset);

  // Check if a Buy setup's established Phase 2 Didi low was breached by >1% (livePrice < Didi * 0.99)
  if (isLowerHalf && dropBars.length >= 2) {
    let establishedBuyDidi: number | null = null;
    for (let m = 0; m < dropBars.length - 1; m++) {
      const globalBarIdx = recentStartIdx + peakOffset + m;
      const bbAtM = getBBAtBarIndex(globalBarIdx);
      const candidateLow = dropBars[m].low;

      const pushedLowerBand = bbAtM
        ? candidateLow <= bbAtM.lower + 0.35 * bbAtM.stdDev
        : true;
      const nearAnyHtfWall = allHtfPrices.some(
        (p) => p > 0 && Math.abs(candidateLow - p) / p <= 0.015
      );

      if (pushedLowerBand && nearAnyHtfWall) {
        let bouncedAfter = false;
        for (let k = m + 1; k < dropBars.length - 1; k++) {
          if (
            dropBars[k].low > candidateLow &&
            dropBars[k].close > candidateLow * 1.003
          ) {
            bouncedAfter = true;
            break;
          }
        }
        if (
          bouncedAfter &&
          (establishedBuyDidi === null || candidateLow < establishedBuyDidi)
        ) {
          establishedBuyDidi = candidateLow;
        }
      }
    }

    if (
      establishedBuyDidi !== null &&
      livePrice < establishedBuyDidi * (1 - DIDI_KNOCKOUT_BUFFER)
    ) {
      const riskPct =
        (Math.abs(livePrice - establishedBuyDidi) / establishedBuyDidi) * 100;
      return {
        state: 'INVALIDATED',
        setupSide: 'BUY',
        ClusterDensityCount: sortedBuyCluster.length,
        RiskToDidiPercentage: riskPct,
        RiskToDidi: riskPct,
        didiPrice: establishedBuyDidi,
        clusterLines: sortedBuyCluster,
        gatekeeperChecks: {
          didNotKnockout: false,
          check1Phase2Diverging: false,
          check2OuterBandPush: false,
          check3OnHtfCluster: sortedBuyCluster.length > 0,
          check4Phase3HookedInward: false,
        },
      };
    }
  }

  // Symmetric: Check if a Sell setup's established Phase 2 Didi high was breached by >1% (livePrice > Didi * 1.01)
  if (!isLowerHalf && rallyBars.length >= 2) {
    let establishedSellDidi: number | null = null;
    for (let m = 0; m < rallyBars.length - 1; m++) {
      const globalBarIdx = recentStartIdx + troughOffset + m;
      const bbAtM = getBBAtBarIndex(globalBarIdx);
      const candidateHigh = rallyBars[m].high;

      const pushedUpperBand = bbAtM
        ? candidateHigh >= bbAtM.upper - 0.35 * bbAtM.stdDev
        : true;
      const nearAnyHtfWall = allHtfPrices.some(
        (p) => p > 0 && Math.abs(candidateHigh - p) / p <= 0.015
      );

      if (pushedUpperBand && nearAnyHtfWall) {
        let pulledBackAfter = false;
        for (let k = m + 1; k < rallyBars.length - 1; k++) {
          if (
            rallyBars[k].high < candidateHigh &&
            rallyBars[k].close < candidateHigh * 0.997
          ) {
            pulledBackAfter = true;
            break;
          }
        }
        if (
          pulledBackAfter &&
          (establishedSellDidi === null || candidateHigh > establishedSellDidi)
        ) {
          establishedSellDidi = candidateHigh;
        }
      }
    }

    if (
      establishedSellDidi !== null &&
      livePrice > establishedSellDidi * (1 + DIDI_KNOCKOUT_BUFFER)
    ) {
      const riskPct =
        (Math.abs(livePrice - establishedSellDidi) / establishedSellDidi) * 100;
      return {
        state: 'INVALIDATED',
        setupSide: 'SELL',
        ClusterDensityCount: sortedSellCluster.length,
        RiskToDidiPercentage: riskPct,
        RiskToDidi: riskPct,
        didiPrice: establishedSellDidi,
        clusterLines: sortedSellCluster,
        gatekeeperChecks: {
          didNotKnockout: false,
          check1Phase2Diverging: false,
          check2OuterBandPush: false,
          check3OnHtfCluster: sortedSellCluster.length > 0,
          check4Phase3HookedInward: false,
        },
      };
    }
  }

  // =========================================================================
  // DETERMINE CANDIDATE DIRECTION & DIDI EXTREME (Didi is intact)
  // =========================================================================
  let setupSide: 'BUY' | 'SELL' | 'NONE' = 'NONE';
  if (sortedBuyCluster.length > 0 && sortedSellCluster.length === 0) {
    setupSide = 'BUY';
  } else if (sortedSellCluster.length > 0 && sortedBuyCluster.length === 0) {
    setupSide = 'SELL';
  } else if (sortedBuyCluster.length > 0 && sortedSellCluster.length > 0) {
    if (currBB) {
      setupSide = livePrice <= currBB.mid ? 'BUY' : 'SELL';
    } else {
      setupSide =
        sortedBuyCluster.length >= sortedSellCluster.length ? 'BUY' : 'SELL';
    }
  }

  const activeCluster =
    setupSide === 'BUY'
      ? sortedBuyCluster
      : setupSide === 'SELL'
      ? sortedSellCluster
      : [];
  const ClusterDensityCount = activeCluster.length;

  const isBuy = setupSide === 'BUY' || (setupSide === 'NONE' && isLowerHalf);
  const didiPrice = isBuy
    ? Math.min(
        ...(dropBars.length > 0 ? dropBars.map((b) => b.low) : [livePrice]),
        livePrice
      )
    : Math.max(
        ...(rallyBars.length > 0 ? rallyBars.map((b) => b.high) : [livePrice]),
        livePrice
      );

  const RiskToDidiPercentage =
    didiPrice > 0 && livePrice > 0
      ? isBuy
        ? ((livePrice - didiPrice) / didiPrice) * 100
        : ((didiPrice - livePrice) / livePrice) * 100
      : 0;

  // =========================================================================
  // STATE B: "NO SETUP" (The Volatility Gatekeeper — Checks 1, 2, and 3)
  // =========================================================================
  const check3OnHtfCluster = ClusterDensityCount >= 1;

  // Check 4 preview: has the opposite Daily Bollinger Band hooked inward toward price (Phase 3)?
  const check4Phase3HookedInward = Boolean(
    currBB &&
      prevBB &&
      setupSide !== 'NONE' &&
      (setupSide === 'BUY'
        ? currBB.upper < prevBB.upper
        : currBB.lower > prevBB.lower)
  );

  // Check 1: Are Daily Bollinger Bands actively diverging (Phase 2) right now,
  // OR (when Phase 3 just hooked inward) were they actively diverging in the preceding 1..4 bars?
  const currentlyDiverging = Boolean(
    currBB &&
      prevBB &&
      currBB.upper > prevBB.upper &&
      currBB.lower < prevBB.lower
  );

  let recentlyDivergedBeforeHook = false;
  if (check4Phase3HookedInward && evalBB.length >= 3) {
    const maxLb = Math.min(4, evalBB.length - 2);
    for (let lb = 1; lb <= maxLb; lb++) {
      const c = evalBB[evalBB.length - 1 - lb];
      const p = evalBB[evalBB.length - 2 - lb];
      if (c && p && c.upper > p.upper && c.lower < p.lower) {
        recentlyDivergedBeforeHook = true;
        break;
      }
    }
  }

  const check1Phase2Diverging =
    currentlyDiverging ||
    (check4Phase3HookedInward && recentlyDivergedBeforeHook);

  // Check 2: Is livePrice (or the immediate Phase 2 test bar) pushing against or exiting the outer band?
  const latestEvalBar =
    evalBars.length > 0 ? evalBars[evalBars.length - 1] : null;
  let check2OuterBandPush = false;
  if (currBB && latestEvalBar && setupSide !== 'NONE') {
    if (setupSide === 'BUY') {
      const livePush =
        Math.min(livePrice, latestEvalBar.low) <=
        currBB.lower + 0.35 * currBB.stdDev;
      let recentPush = false;
      if (check4Phase3HookedInward && livePrice <= currBB.mid) {
        for (let lb = 1; lb <= Math.min(3, evalBars.length - 1); lb++) {
          const bIdx = evalBars.length - 1 - lb;
          const bbK = getBBAtBarIndex(bIdx);
          if (bbK && evalBars[bIdx].low <= bbK.lower + 0.3 * bbK.stdDev) {
            recentPush = true;
            break;
          }
        }
      }
      check2OuterBandPush = livePush || recentPush;
    } else {
      const livePush =
        Math.max(livePrice, latestEvalBar.high) >=
        currBB.upper - 0.35 * currBB.stdDev;
      let recentPush = false;
      if (check4Phase3HookedInward && livePrice >= currBB.mid) {
        for (let lb = 1; lb <= Math.min(3, evalBars.length - 1); lb++) {
          const bIdx = evalBars.length - 1 - lb;
          const bbK = getBBAtBarIndex(bIdx);
          if (bbK && evalBars[bIdx].high >= bbK.upper - 0.3 * bbK.stdDev) {
            recentPush = true;
            break;
          }
        }
      }
      check2OuterBandPush = livePush || recentPush;
    }
  }

  if (!check1Phase2Diverging || !check2OuterBandPush || !check3OnHtfCluster) {
    return {
      state: 'NO SETUP',
      setupSide,
      ClusterDensityCount,
      RiskToDidiPercentage: Math.max(0, RiskToDidiPercentage),
      RiskToDidi: Math.max(0, RiskToDidiPercentage),
      didiPrice,
      clusterLines: activeCluster,
      gatekeeperChecks: {
        didNotKnockout: true,
        check1Phase2Diverging,
        check2OuterBandPush,
        check3OnHtfCluster,
        check4Phase3HookedInward,
      },
    };
  }

  // =========================================================================
  // STATE C vs STATE D (Check 4 — Phase 3 Trajectory Hook Check)
  // =========================================================================
  const finalState: AtsState = check4Phase3HookedInward
    ? 'STEP 2: REVERSAL CONFIRMED'
    : 'STEP 1: THE WALL';

  return {
    state: finalState,
    setupSide,
    ClusterDensityCount,
    RiskToDidiPercentage: Math.max(0, RiskToDidiPercentage),
    RiskToDidi: Math.max(0, RiskToDidiPercentage),
    didiPrice,
    clusterLines: activeCluster,
    gatekeeperChecks: {
      didNotKnockout: true,
      check1Phase2Diverging,
      check2OuterBandPush,
      check3OnHtfCluster,
      check4Phase3HookedInward,
    },
  };
}

/**
 * Builds the full ScreenerResult payload powered by `detectAtsSetup(assetData)`.
 */
export function evaluateATSScreener(params: {
  symbol: string;
  displaySymbol: string;
  name?: string;
  category: AssetCategory;
  livePrice: number;
  change24hPct: number;
  timeframes: Record<Timeframe, TimeframeATSData>;
  Didi: DidiTarget | null;
  downsideDidi?: DidiTarget | null;
}): ScreenerResult {
  const {
    symbol,
    displaySymbol,
    name,
    category,
    livePrice,
    change24hPct,
    timeframes,
    Didi,
    downsideDidi = null,
  } = params;

  const horizonMatrix = buildHorizonMatrix(timeframes, livePrice);
  const detection = detectAtsSetup({ livePrice, timeframes });

  const htfGreenBaselines: ATSBaseline[] = [];
  const htfRedBaselines: ATSBaseline[] = [];
  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    for (const line of flattenTimeframeBaselines(
      tfData.Jack,
      tfData.Oggy,
      true
    )) {
      if (line.polarity === 'GREEN' && line.price <= livePrice) {
        htfGreenBaselines.push(line);
      } else if (line.polarity === 'RED' && line.price >= livePrice) {
        htfRedBaselines.push(line);
      }
    }
  }

  const nearestGreenSupport =
    htfGreenBaselines.length > 0
      ? [...htfGreenBaselines].sort(
          (a, b) =>
            Math.abs(livePrice - a.price) - Math.abs(livePrice - b.price)
        )[0]
      : null;

  const nearestRedResistance =
    htfRedBaselines.length > 0
      ? [...htfRedBaselines].sort(
          (a, b) =>
            Math.abs(a.price - livePrice) - Math.abs(b.price - livePrice)
        )[0]
      : null;

  const isActiveSetup =
    detection.state === 'STEP 1: THE WALL' ||
    detection.state === 'STEP 2: REVERSAL CONFIRMED';

  const direction: SetupDirection =
    detection.setupSide === 'BUY'
      ? 'LONG'
      : detection.setupSide === 'SELL'
      ? 'SHORT'
      : 'NEUTRAL';

  const signalStatus: SetupConfirmationStatus =
    detection.state === 'STEP 2: REVERSAL CONFIRMED'
      ? 'CONFIRMED'
      : detection.state === 'STEP 1: THE WALL'
      ? 'CANDIDATE'
      : 'WATCH';

  const isAtSupportWall = isActiveSetup && direction === 'LONG';
  const isAtResistanceWall = isActiveSetup && direction === 'SHORT';
  const isAtWall = isAtSupportWall || isAtResistanceWall;

  const primaryLine =
    detection.clusterLines.length > 0 ? detection.clusterLines[0] : null;
  const nearestAnyLine = (() => {
    if (nearestGreenSupport && nearestRedResistance) {
      const dSup = Math.abs(livePrice - nearestGreenSupport.price);
      const dRes = Math.abs(nearestRedResistance.price - livePrice);
      return dSup <= dRes ? nearestGreenSupport : nearestRedResistance;
    }
    return nearestGreenSupport ?? nearestRedResistance;
  })();

  const activeWallLabel = primaryLine
    ? detection.clusterLines.length > 1
      ? `${primaryLine.label} (+${detection.clusterLines.length - 1})`
      : primaryLine.label
    : nearestAnyLine
    ? `${nearestAnyLine.label} (${(
        (Math.abs(livePrice - nearestAnyLine.price) / livePrice) *
        100
      ).toFixed(1)}%)`
    : 'No Unbroken Wall';

  const wallPrice = primaryLine
    ? primaryLine.price
    : nearestAnyLine?.price ?? null;

  const wallProximityPct =
    wallPrice !== null
      ? (Math.abs(livePrice - wallPrice) / livePrice) * 100
      : null;

  const isShortBias = direction === 'SHORT';
  const stopLoss = detection.didiPrice;
  const riskPct = detection.RiskToDidiPercentage;
  const effectiveTargetTP1 = isShortBias ? downsideDidi : Didi;

  const m20Candidates: MacroTargetTP2[] = [];
  for (const tf of ['D', ...HIGHER_TIMEFRAMES] as Timeframe[]) {
    const m20 =
      timeframes[tf].latestSMA20?.value ?? timeframes[tf].latestBB?.mid;
    if (!m20 || m20 <= 0) continue;
    const signedPct = ((m20 - livePrice) / livePrice) * 100;
    if (!isShortBias && signedPct > 0.6) {
      m20Candidates.push({
        price: m20,
        label: `${tf}-M20`,
        timeframe: tf,
        upsidePct: signedPct,
      });
    } else if (isShortBias && signedPct < -0.6) {
      m20Candidates.push({
        price: m20,
        label: `${tf}-M20`,
        timeframe: tf,
        upsidePct: signedPct,
      });
    }
  }

  let macroTargetTP2: MacroTargetTP2 | null = null;
  if (m20Candidates.length > 0) {
    m20Candidates.sort(
      (a, b) => Math.abs(a.upsidePct) - Math.abs(b.upsidePct)
    );
    macroTargetTP2 = m20Candidates[0];
  }

  const riskAmount = Math.max(
    Math.abs(livePrice - stopLoss),
    livePrice * 0.002
  );
  const liveReward =
    macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.4
      ? Math.abs(macroTargetTP2.price - livePrice)
      : 0;
  const riskRewardRatio =
    liveReward > 0 && riskAmount > 0 ? liveReward / riskAmount : null;

  const volatilitySignal =
    detection.state === 'STEP 2: REVERSAL CONFIRMED'
      ? 'Phase 3 (Opposite Daily BB hooked inward)'
      : detection.state === 'STEP 1: THE WALL'
      ? 'Phase 2 (Daily BBs diverging — Peak Volatility)'
      : detection.gatekeeperChecks.check1Phase2Diverging
      ? 'Phase 2 Diverging'
      : 'Phase 1 / Non-Diverging';

  // Chronological State Explanation
  let thesisHeadline = '';
  const reasoningBullets: string[] = [];
  const g = detection.gatekeeperChecks;

  if (detection.state === 'INVALIDATED') {
    thesisHeadline = `INVALIDATED — Live price (${fmtNum(
      livePrice,
      category
    )}) breached established Didi (${fmtNum(
      detection.didiPrice,
      category
    )}) by ${detection.RiskToDidiPercentage.toFixed(2)}% (>1% buffer).`;
    reasoningBullets.push(
      `State A (Knockout Rule): Didi (${fmtNum(
        detection.didiPrice,
        category
      )}) was breached by ${detection.RiskToDidiPercentage.toFixed(
        2
      )}% (>1% buffer) — stop-loss broken.`
    );
  } else if (detection.state === 'STEP 2: REVERSAL CONFIRMED') {
    const lineList = detection.clusterLines
      .slice(0, 4)
      .map((l) => `${l.label} (${fmtNum(l.price, category)})`)
      .join(' + ');
    thesisHeadline = `${detection.setupSide} • STEP 2: REVERSAL CONFIRMED (Conservative) — ${detection.ClusterDensityCount}-line wall [${lineList}] • Opposite Daily BB hooked inward.`;
    reasoningBullets.push(
      `Cluster Density (${detection.ClusterDensityCount} unbroken HTF line${
        detection.ClusterDensityCount > 1 ? 's' : ''
      } within 1%): ${lineList}.`
    );
    reasoningBullets.push(
      `Didi Intact: ${fmtNum(
        detection.didiPrice,
        category
      )} (${detection.RiskToDidiPercentage.toFixed(2)}% Risk to Didi).`
    );
    reasoningBullets.push(
      'Check 4 (Phase 3 Confirmed): Opposite Daily Bollinger Band has hooked inward toward price.'
    );
  } else if (detection.state === 'STEP 1: THE WALL') {
    const lineList = detection.clusterLines
      .slice(0, 4)
      .map((l) => `${l.label} (${fmtNum(l.price, category)})`)
      .join(' + ');
    thesisHeadline = `${detection.setupSide} • STEP 1: THE WALL (Aggressive) — ${detection.ClusterDensityCount}-line wall [${lineList}] • Pushing outer Daily BB in Phase 2.`;
    reasoningBullets.push(
      `Cluster Density (${detection.ClusterDensityCount} unbroken HTF line${
        detection.ClusterDensityCount > 1 ? 's' : ''
      } within 1%): ${lineList}.`
    );
    reasoningBullets.push(
      `Didi Intact: ${fmtNum(
        detection.didiPrice,
        category
      )} (${detection.RiskToDidiPercentage.toFixed(2)}% Risk to Didi).`
    );
    reasoningBullets.push(
      'Check 4 (Phase 2 Active): Opposite Daily Bollinger Band is still widening — aggressive sniper entry on the wall.'
    );
  } else {
    const failedReasons: string[] = [];
    if (!g.check3OnHtfCluster) {
      failedReasons.push('Not within 1% of an unbroken HTF Jack/Oggy cluster');
    }
    if (!g.check1Phase2Diverging) {
      failedReasons.push('Daily Bollinger Bands not diverging (Phase 2)');
    }
    if (!g.check2OuterBandPush) {
      failedReasons.push('Price not pushing/exiting outer Daily Bollinger Band');
    }
    thesisHeadline = `NO SETUP — ${failedReasons.join(' · ')}`;
    reasoningBullets.push(
      `Check 1 (Daily BB Phase 2 Diverging): ${
        g.check1Phase2Diverging ? 'YES ✓' : 'NO ✗'
      }`
    );
    reasoningBullets.push(
      `Check 2 (Pushing/Exiting Outer Daily BB): ${
        g.check2OuterBandPush ? 'YES ✓' : 'NO ✗'
      }`
    );
    reasoningBullets.push(
      `Check 3 (Within 1% of Unbroken HTF Cluster): ${
        g.check3OnHtfCluster
          ? `YES ✓ (${detection.ClusterDensityCount} line${
              detection.ClusterDensityCount > 1 ? 's' : ''
            })`
          : 'NO ✗ (0 lines)'
      }`
    );
  }

  return {
    symbol,
    displaySymbol,
    name,
    category,
    livePrice,
    change24hPct,
    atsState: detection.state,
    setupSide: detection.setupSide,
    direction,
    signalStatus,
    ClusterDensityCount: detection.ClusterDensityCount,
    RiskToDidi: detection.RiskToDidi,
    RiskToDidiPercentage: detection.RiskToDidiPercentage,
    didiPrice: detection.didiPrice,
    gatekeeperChecks: detection.gatekeeperChecks,
    isAtWall,
    isAtSupportWall,
    isAtResistanceWall,
    activeWallLabel,
    wallPrice,
    wallProximityPct,
    confluentWallLines:
      detection.setupSide === 'BUY' ? detection.clusterLines : [],
    confluentResistanceLines:
      detection.setupSide === 'SELL' ? detection.clusterLines : [],
    nearestGreenSupport,
    nearestRedResistance,
    volatilitySignal,
    stopLoss,
    riskPct,
    Didi,
    downsideDidi,
    effectiveTargetTP1,
    macroTargetTP2,
    riskRewardRatio,
    horizonMatrix,
    thesisHeadline,
    reasoningBullets,
  };
}
