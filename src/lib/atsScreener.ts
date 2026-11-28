import { flattenTimeframeBaselines } from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  AtsState,
  AtsStateDetectionResult,
  DidiTarget,
  MacroTargetTP2,
  MatchedHTFLevel,
  ScreenerResult,
  SetupConfirmationStatus,
  SetupDirection,
  SetupScoreBreakdown,
  Timeframe,
  TimeframeATSData,
  TimeframeHorizonSummary,
} from '../types/ats.ts';

/**
 * Timeframe hierarchy rank: higher timeframe setups ALWAYS outrank lower timeframe setups.
 * (e.g., 3M BB exit + 6M/12M resistance >> D BB exit + W resistance)
 */
export const TIMEFRAME_RANK: Record<Timeframe, number> = {
  D: 0,
  W: 1,
  M: 2,
  '3M': 3,
  '6M': 4,
  '12M': 5,
};

/** Trigger timeframes scanned from HIGHEST to LOWEST (12M has no higher TF above it) */
const TRIGGER_TIMEFRAMES_DESC: readonly Timeframe[] = [
  '6M',
  '3M',
  'M',
  'W',
  'D',
] as const;

/** Proximity % tolerance by Higher Timeframe (higher TFs have much larger candles, so 4-6% is visually touching) */
const HTF_SR_PROXIMITY_TOL_BY_TF: Record<Timeframe, number> = {
  D: 0.02,
  W: 0.025,
  M: 0.04,
  '3M': 0.05,
  '6M': 0.055,
  '12M': 0.06,
};

/** Small AT.S "Autour" touch halo for dynamic curves (MM7, MM20, BB) that still hold their Green/Red slope color */
const DYNAMIC_CURVE_OVERSHOOT_BY_TF: Record<Timeframe, number> = {
  D: 0.005,
  W: 0.01,
  M: 0.02,
  '3M': 0.03,
  '6M': 0.03,
  '12M': 0.03,
};

const TRIGGER_TF_SCORE: Record<Timeframe, number> = {
  D: 3,
  W: 6,
  M: 10,
  '3M': 13,
  '6M': 16,
  '12M': 16,
};

const HTF_SR_TF_SCORE: Record<Timeframe, number> = {
  D: 1,
  W: 3,
  M: 6,
  '3M': 9,
  '6M': 11,
  '12M': 14,
};

/**
 * 0-100 Setup Confidence Score combining 4 pillars:
 * - Pillar 1 (0-30): Timeframe Power (BB-exit Trigger TF + Highest S/R TF)
 * - Pillar 2 (0-30): Number of Higher-TF Supports/Resistances backing the setup (+ Multi-HTF bonus)
 * - Pillar 3 (0-20): Earliness / Proximity to Didi (closer to Didi = earlier = higher score)
 * - Pillar 4 (0-20): Bollinger Band Divergence on the trigger TF (stronger divergence = higher score)
 */
export function computeSetupConfidenceScore(params: {
  triggerTf: Timeframe;
  matchedLevels: MatchedHTFLevel[];
  riskToDidiPct: number;
  phase2Diverging: boolean;
  bbExpansionPct: number;
}): { score: number; breakdown: SetupScoreBreakdown } {
  const {
    triggerTf,
    matchedLevels,
    riskToDidiPct,
    phase2Diverging,
    bbExpansionPct,
  } = params;
  if (matchedLevels.length === 0) {
    return {
      score: 0,
      breakdown: {
        timeframePts: 0,
        srCountPts: 0,
        earlinessPts: 0,
        bbDivergencePts: 0,
        bbExpansionPct: 0,
        distinctHtfCount: 0,
      },
    };
  }

  // Pillar 1: Timeframe Power (max 30)
  const highestHtf = matchedLevels[0].timeframe;
  const timeframePts = Math.min(
    30,
    TRIGGER_TF_SCORE[triggerTf] + HTF_SR_TF_SCORE[highestHtf]
  );

  // Pillar 2: Number of Supports/Resistances + Multi-HTF Confluence (max 30)
  const count = matchedLevels.length;
  const distinctHtfCount = new Set(matchedLevels.map((l) => l.timeframe)).size;
  const baseCountPts =
    count >= 4 ? 27 : count === 3 ? 23 : count === 2 ? 17 : 8;
  const multiHtfBonus = distinctHtfCount >= 2 ? 3 : 0;
  const srCountPts = Math.min(30, baseCountPts + multiHtfBonus);

  // Pillar 3: Earliness / Proximity to Didi (max 20)
  let earlinessPts = 2;
  if (riskToDidiPct <= 0.5) earlinessPts = 20;
  else if (riskToDidiPct <= 1.0) earlinessPts = 17;
  else if (riskToDidiPct <= 2.0) earlinessPts = 13;
  else if (riskToDidiPct <= 3.5) earlinessPts = 9;
  else if (riskToDidiPct <= 5.5) earlinessPts = 5;

  // Pillar 4: Bollinger Band Divergence on Trigger TF (max 20)
  let bbDivergencePts = 0;
  if (phase2Diverging) {
    if (bbExpansionPct >= 25) bbDivergencePts = 20;
    else if (bbExpansionPct >= 15) bbDivergencePts = 17;
    else if (bbExpansionPct >= 8) bbDivergencePts = 14;
    else if (bbExpansionPct >= 3) bbDivergencePts = 11;
    else bbDivergencePts = 8;
  } else if (bbExpansionPct >= 10) {
    bbDivergencePts = 7;
  } else if (bbExpansionPct > 0) {
    bbDivergencePts = 4;
  }

  const score = Math.min(
    100,
    timeframePts + srCountPts + earlinessPts + bbDivergencePts
  );
  return {
    score,
    breakdown: {
      timeframePts,
      srCountPts,
      earlinessPts,
      bbDivergencePts,
      bbExpansionPct: Math.round(bbExpansionPct * 10) / 10,
      distinctHtfCount,
    },
  };
}

export const ATS_STATE_SORT_PRIORITY: Record<AtsState, number> = {
  'STEP 2: REVERSAL CONFIRMED': 3,
  'STEP 1: THE WALL': 2,
  'NO SETUP': 1,
  INVALIDATED: 0,
};

export type ScreenerSortKey = 'STATE' | 'CLUSTER' | 'RISK';

/**
 * Sorts screener results with Higher-Timeframe BB-Exit + HTF S/R setups always at the top:
 * - Default ('STATE'): Active setups first -> Highest `setupHierarchyRank` (trigger TF -> HTF S/R TF) -> ClusterDensityCount (desc) -> RiskToDidi (asc).
 * - 'CLUSTER': ClusterDensityCount (desc) -> setupHierarchyRank (desc) -> RiskToDidi (asc).
 * - 'RISK': Active setups first -> RiskToDidi (asc) -> setupHierarchyRank (desc).
 */
export function compareScreenerResults(
  a: ScreenerResult,
  b: ScreenerResult,
  sortKey: ScreenerSortKey = 'STATE'
): number {
  const aActive =
    a.atsState === 'STEP 1: THE WALL' ||
    a.atsState === 'STEP 2: REVERSAL CONFIRMED';
  const bActive =
    b.atsState === 'STEP 1: THE WALL' ||
    b.atsState === 'STEP 2: REVERSAL CONFIRMED';

  if (sortKey === 'CLUSTER') {
    if (b.ClusterDensityCount !== a.ClusterDensityCount) {
      return b.ClusterDensityCount - a.ClusterDensityCount;
    }
    if (b.setupHierarchyRank !== a.setupHierarchyRank) {
      return b.setupHierarchyRank - a.setupHierarchyRank;
    }
    return a.RiskToDidi - b.RiskToDidi;
  }

  if (sortKey === 'RISK') {
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (a.RiskToDidi !== b.RiskToDidi) return a.RiskToDidi - b.RiskToDidi;
    return b.setupHierarchyRank - a.setupHierarchyRank;
  }

  // Default ('STATE'): Active setups first -> Highest Confidence Score (0-100) -> S/R Count -> Higher TF Rank -> Tightest Risk to Didi
  if (aActive !== bActive) return aActive ? -1 : 1;
  if (b.setupConfidenceScore !== a.setupConfidenceScore) {
    return b.setupConfidenceScore - a.setupConfidenceScore;
  }
  if (b.ClusterDensityCount !== a.ClusterDensityCount) {
    return b.ClusterDensityCount - a.ClusterDensityCount;
  }
  if (b.setupHierarchyRank !== a.setupHierarchyRank) {
    return b.setupHierarchyRank - a.setupHierarchyRank;
  }
  const stateDiff =
    ATS_STATE_SORT_PRIORITY[b.atsState] - ATS_STATE_SORT_PRIORITY[a.atsState];
  if (stateDiff !== 0) return stateDiff;
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
      if (absDistPct <= 1.5) {
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
 * Finds all valid Higher-Timeframe (`htf > triggerTf`) Supports (for Bottom BB Exit)
 * or Resistances (for Top BB Exit) among: SAR, MM7, MM20, Jack, and Oggy.
 */
function findHigherTimeframeSR(params: {
  triggerTf: Timeframe;
  side: 'BUY' | 'SELL';
  livePrice: number;
  refExtremePrice: number;
  timeframes: Record<Timeframe, TimeframeATSData>;
}): {
  matchedLevels: MatchedHTFLevel[];
  matchedBaselines: ATSBaseline[];
} {
  const { triggerTf, side, livePrice, refExtremePrice, timeframes } = params;
  const triggerRank = TIMEFRAME_RANK[triggerTf];
  const higherTfs = ALL_TIMEFRAMES.filter(
    (tf) => TIMEFRAME_RANK[tf] > triggerRank
  );

  const matchedLevels: MatchedHTFLevel[] = [];
  const matchedBaselines: ATSBaseline[] = [];

  for (const htf of higherTfs) {
    const htfData = timeframes[htf];
    const proximityTol = HTF_SR_PROXIMITY_TOL_BY_TF[htf];
    const curveOvershoot = DYNAMIC_CURVE_OVERSHOOT_BY_TF[htf];

    // 1. Unbroken Jack & Oggy baselines (strictly excluding pierced lines)
    const unbroken = flattenTimeframeBaselines(htfData.Jack, htfData.Oggy, true);
    for (const line of unbroken) {
      if (side === 'BUY') {
        if (line.polarity === 'GREEN' && line.price <= livePrice) {
          const distLive = (livePrice - line.price) / livePrice;
          const distExt = Math.abs(refExtremePrice - line.price) / livePrice;
          if (distLive <= proximityTol || distExt <= proximityTol) {
            matchedLevels.push({
              label: line.label,
              timeframe: htf,
              kind: line.family,
              price: line.price,
              distancePct: distLive * 100,
            });
            matchedBaselines.push(line);
          }
        }
      } else {
        if (line.polarity === 'RED' && line.price >= livePrice) {
          const distLive = (line.price - livePrice) / livePrice;
          const distExt = Math.abs(line.price - refExtremePrice) / livePrice;
          if (distLive <= proximityTol || distExt <= proximityTol) {
            matchedLevels.push({
              label: line.label,
              timeframe: htf,
              kind: line.family,
              price: line.price,
              distancePct: distLive * 100,
            });
            matchedBaselines.push(line);
          }
        }
      }
    }

    // 2. MM7 (SMA 7) — Green/rising for Support, Red/falling for Resistance (with HTF "Autour" curve halo)
    if (htfData.latestSMA7 && htfData.latestSMA7.value > 0) {
      const m7 = htfData.latestSMA7.value;
      if (
        side === 'BUY' &&
        htfData.latestSMA7.isGreen &&
        m7 <= livePrice * (1 + curveOvershoot)
      ) {
        const distLive = Math.abs(livePrice - m7) / livePrice;
        const distExt = Math.abs(refExtremePrice - m7) / livePrice;
        if (distLive <= proximityTol || distExt <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-MM7`,
            timeframe: htf,
            kind: 'MM7',
            price: m7,
            distancePct: distLive * 100,
          });
        }
      } else if (
        side === 'SELL' &&
        !htfData.latestSMA7.isGreen &&
        m7 >= livePrice * (1 - curveOvershoot)
      ) {
        const distLive = Math.abs(m7 - livePrice) / livePrice;
        const distExt = Math.abs(m7 - refExtremePrice) / livePrice;
        if (distLive <= proximityTol || distExt <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-MM7`,
            timeframe: htf,
            kind: 'MM7',
            price: m7,
            distancePct: distLive * 100,
          });
        }
      }
    }

    // 3. MM20 (SMA 20) — Green/rising for Support, Red/falling for Resistance (with HTF "Autour" curve halo)
    if (htfData.latestSMA20 && htfData.latestSMA20.value > 0) {
      const m20 = htfData.latestSMA20.value;
      if (
        side === 'BUY' &&
        htfData.latestSMA20.isGreen &&
        m20 <= livePrice * (1 + curveOvershoot)
      ) {
        const distLive = Math.abs(livePrice - m20) / livePrice;
        const distExt = Math.abs(refExtremePrice - m20) / livePrice;
        if (distLive <= proximityTol || distExt <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-MM20`,
            timeframe: htf,
            kind: 'MM20',
            price: m20,
            distancePct: distLive * 100,
          });
        }
      } else if (
        side === 'SELL' &&
        !htfData.latestSMA20.isGreen &&
        m20 >= livePrice * (1 - curveOvershoot)
      ) {
        const distLive = Math.abs(m20 - livePrice) / livePrice;
        const distExt = Math.abs(m20 - refExtremePrice) / livePrice;
        if (distLive <= proximityTol || distExt <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-MM20`,
            timeframe: htf,
            kind: 'MM20',
            price: m20,
            distancePct: distLive * 100,
          });
        }
      }
    }

    // 4. Wilder SAR AT.S — Strictly unbroken & unflipped on the current HTF bar:
    //    Bullish (below price, bar low >= sar) for Support; Bearish (above price, bar high <= sar) for Resistance
    const htfLastBar =
      htfData.bars.length > 0 ? htfData.bars[htfData.bars.length - 1] : null;
    if (htfData.latestSAR && htfData.latestSAR.value > 0) {
      const sar = htfData.latestSAR.value;
      if (
        side === 'BUY' &&
        htfData.latestSAR.isBullish &&
        sar <= livePrice &&
        (!htfLastBar || htfLastBar.low >= sar)
      ) {
        const dist = (livePrice - sar) / livePrice;
        if (dist <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-SAR`,
            timeframe: htf,
            kind: 'SAR',
            price: sar,
            distancePct: dist * 100,
          });
        }
      } else if (
        side === 'SELL' &&
        !htfData.latestSAR.isBullish &&
        sar >= livePrice &&
        (!htfLastBar || htfLastBar.high <= sar)
      ) {
        const dist = (sar - livePrice) / livePrice;
        if (dist <= proximityTol) {
          matchedLevels.push({
            label: `${htf}-SAR`,
            timeframe: htf,
            kind: 'SAR',
            price: sar,
            distancePct: dist * 100,
          });
        }
      }
    }

    // 5. Higher-Timeframe Bollinger Bands — STRICT color polarity + HTF "Autour" curve halo:
    //    Green (rising) = Support (BUY only), Red (falling) = Resistance (SELL only)
    if (htfData.latestBB) {
      const { upper, lower, upperGreen, lowerGreen } = htfData.latestBB;
      if (side === 'BUY') {
        if (lower > 0 && lowerGreen && lower <= livePrice * (1 + curveOvershoot)) {
          const distLive = Math.abs(livePrice - lower) / livePrice;
          const distExt = Math.abs(refExtremePrice - lower) / livePrice;
          if (
            distLive <= proximityTol ||
            distExt <= proximityTol
          ) {
            matchedLevels.push({
              label: `${htf}-BB Low`,
              timeframe: htf,
              kind: 'BB',
              price: lower,
              distancePct: distLive * 100,
            });
          }
        }
        if (upper > 0 && upperGreen && upper <= livePrice * (1 + curveOvershoot)) {
          const distLive = Math.abs(livePrice - upper) / livePrice;
          const distExt = Math.abs(refExtremePrice - upper) / livePrice;
          if (
            distLive <= proximityTol ||
            distExt <= proximityTol
          ) {
            matchedLevels.push({
              label: `${htf}-BB Up`,
              timeframe: htf,
              kind: 'BB',
              price: upper,
              distancePct: distLive * 100,
            });
          }
        }
      } else {
        if (upper > 0 && !upperGreen && upper >= livePrice * (1 - curveOvershoot)) {
          const distLive = Math.abs(upper - livePrice) / livePrice;
          const distExt = Math.abs(upper - refExtremePrice) / livePrice;
          if (
            distLive <= proximityTol ||
            distExt <= proximityTol
          ) {
            matchedLevels.push({
              label: `${htf}-BB Up`,
              timeframe: htf,
              kind: 'BB',
              price: upper,
              distancePct: distLive * 100,
            });
          }
        }
        if (lower > 0 && !lowerGreen && lower >= livePrice * (1 - curveOvershoot)) {
          const distLive = Math.abs(lower - livePrice) / livePrice;
          const distExt = Math.abs(lower - refExtremePrice) / livePrice;
          if (
            distLive <= proximityTol ||
            distExt <= proximityTol
          ) {
            matchedLevels.push({
              label: `${htf}-BB Low`,
              timeframe: htf,
              kind: 'BB',
              price: lower,
              distancePct: distLive * 100,
            });
          }
        }
      }
    }
  }

  // Sort matched levels by highest timeframe first, then closest to livePrice
  matchedLevels.sort((a, b) => {
    const tfDiff = TIMEFRAME_RANK[b.timeframe] - TIMEFRAME_RANK[a.timeframe];
    if (tfDiff !== 0) return tfDiff;
    return a.distancePct - b.distancePct;
  });

  return { matchedLevels, matchedBaselines };
}

/**
 * Simplified Multi-Timeframe BB-Exit + Higher-Timeframe Support/Resistance Screener:
 *
 * 1. Scans trigger timeframes from HIGHEST to LOWEST (`6M -> 3M -> M -> W -> D`).
 * 2. Checks if price is exiting the Bollinger Band by the BOTTOM (Buy) or by the TOP (Sell).
 * 3. Checks if combined with a Support (Bottom exit) or Resistance (Top exit) on a STRICTLY HIGHER
 *    timeframe (`htf > triggerTf`) using: SAR, MM7, MM20, Jack, or Oggy.
 * 4. Ranks higher-timeframe setups strictly above lower-timeframe setups
 *    (e.g. 3M BB exit + 6M/12M resistance >> D BB exit + W resistance).
 */
export function detectAtsSetup(assetData: {
  livePrice: number;
  timeframes: Record<Timeframe, TimeframeATSData>;
}): AtsStateDetectionResult {
  const { livePrice, timeframes } = assetData;

  let bestMatch: {
    triggerTf: Timeframe;
    side: 'BUY' | 'SELL';
    highestHtf: Timeframe;
    rank: number;
    score: number;
    scoreBreakdown: SetupScoreBreakdown;
    matchedLevels: MatchedHTFLevel[];
    matchedBaselines: ATSBaseline[];
    didiPrice: number;
    riskToDidiPct: number;
    phase3HookedInward: boolean;
    phase2Diverging: boolean;
  } | null = null;

  for (const triggerTf of TRIGGER_TIMEFRAMES_DESC) {
    const tfData = timeframes[triggerTf];
    const bars = tfData.bars;
    const bbArr = tfData.bollingerBands;
    if (bars.length < 2 || bbArr.length < 2) continue;

    const curBar = bars[bars.length - 1];
    const currBB = bbArr[bbArr.length - 1];
    const prevBB = bbArr[bbArr.length - 2];
    if (currBB.upper <= currBB.lower) continue;

    // Check if price gets out of the Bollinger Band by the BOTTOM or by the TOP on `triggerTf`
    const exitedBottom =
      livePrice < currBB.lower ||
      (curBar.low < currBB.lower && livePrice <= currBB.lower * 1.015);
    const exitedTop =
      livePrice > currBB.upper ||
      (curBar.high > currBB.upper && livePrice >= currBB.upper * 0.985);

    if (!exitedBottom && !exitedTop) continue;

    const sidesToCheck: Array<'BUY' | 'SELL'> = [];
    if (exitedBottom) sidesToCheck.push('BUY');
    if (exitedTop) sidesToCheck.push('SELL');

    for (const side of sidesToCheck) {
      const refExtremePrice =
        side === 'BUY'
          ? Math.min(curBar.low, livePrice)
          : Math.max(curBar.high, livePrice);

      const { matchedLevels, matchedBaselines } = findHigherTimeframeSR({
        triggerTf,
        side,
        livePrice,
        refExtremePrice,
        timeframes,
      });

      if (matchedLevels.length === 0) continue;

      const highestHtf = matchedLevels[0].timeframe;
      const triggerRank = TIMEFRAME_RANK[triggerTf];
      const htfRank = TIMEFRAME_RANK[highestHtf];
      // Higher trigger timeframe & higher S/R timeframe ALWAYS outrank lower timeframes
      const rank =
        triggerRank * 100 + htfRank * 15 + Math.min(14, matchedLevels.length);

      const oppositeHookedInward =
        side === 'BUY'
          ? currBB.upper < prevBB.upper
          : currBB.lower > prevBB.lower;
      const stillActivelyBreakingOut =
        (side === 'BUY' ? livePrice < currBB.lower : livePrice > currBB.upper) &&
        currBB.bandwidth >= prevBB.bandwidth;
      const phase3HookedInward =
        oppositeHookedInward && !stillActivelyBreakingOut;
      const phase2Diverging =
        currBB.upper > prevBB.upper && currBB.lower < prevBB.lower;

      // Measure Bollinger Band divergence strength (% bandwidth expansion over 1-2 bars)
      const prev2BB = bbArr.length >= 3 ? bbArr[bbArr.length - 3] : null;
      const bwExp1 =
        prevBB.bandwidth > 0
          ? ((currBB.bandwidth - prevBB.bandwidth) / prevBB.bandwidth) * 100
          : 0;
      const bwExp2 =
        prev2BB && prev2BB.bandwidth > 0
          ? (((currBB.bandwidth - prev2BB.bandwidth) / prev2BB.bandwidth) *
              100) *
            0.65
          : bwExp1;
      const bbExpansionPct = Math.max(bwExp1, bwExp2);

      const didiPrice = refExtremePrice;
      const riskToDidiPct =
        didiPrice > 0 && livePrice > 0
          ? side === 'BUY'
            ? Math.max(0, ((livePrice - didiPrice) / didiPrice) * 100)
            : Math.max(0, ((didiPrice - livePrice) / livePrice) * 100)
          : 0;

      const { score, breakdown } = computeSetupConfidenceScore({
        triggerTf,
        matchedLevels,
        riskToDidiPct,
        phase2Diverging,
        bbExpansionPct,
      });

      if (
        !bestMatch ||
        score > bestMatch.score ||
        (score === bestMatch.score && rank > bestMatch.rank)
      ) {
        bestMatch = {
          triggerTf,
          side,
          highestHtf,
          rank,
          score,
          scoreBreakdown: breakdown,
          matchedLevels,
          matchedBaselines,
          didiPrice,
          riskToDidiPct,
          phase3HookedInward,
          phase2Diverging,
        };
      }
    }
  }

  if (!bestMatch) {
    const dBars = timeframes.D.bars;
    const latestD = dBars.length > 0 ? dBars[dBars.length - 1] : null;
    const fallbackDidi = latestD ? latestD.low : livePrice;
    const fallbackRisk =
      fallbackDidi > 0
        ? Math.max(0, ((livePrice - fallbackDidi) / fallbackDidi) * 100)
        : 0;

    return {
      state: 'NO SETUP',
      setupSide: 'NONE',
      bbExitTimeframe: null,
      highestHtfTimeframe: null,
      setupHierarchyRank: 0,
      setupConfidenceScore: 0,
      scoreBreakdown: {
        timeframePts: 0,
        srCountPts: 0,
        earlinessPts: 0,
        bbDivergencePts: 0,
        bbExpansionPct: 0,
        distinctHtfCount: 0,
      },
      matchedHtfLevels: [],
      ClusterDensityCount: 0,
      RiskToDidiPercentage: fallbackRisk,
      RiskToDidi: fallbackRisk,
      didiPrice: fallbackDidi,
      clusterLines: [],
      gatekeeperChecks: {
        didNotKnockout: true,
        check1Phase2Diverging: false,
        check2OuterBandPush: false,
        check3OnHtfCluster: false,
        check4Phase3HookedInward: false,
      },
    };
  }

  const state: AtsState = bestMatch.phase3HookedInward
    ? 'STEP 2: REVERSAL CONFIRMED'
    : 'STEP 1: THE WALL';

  return {
    state,
    setupSide: bestMatch.side,
    bbExitTimeframe: bestMatch.triggerTf,
    highestHtfTimeframe: bestMatch.highestHtf,
    setupHierarchyRank: bestMatch.rank,
    setupConfidenceScore: bestMatch.score,
    scoreBreakdown: bestMatch.scoreBreakdown,
    matchedHtfLevels: bestMatch.matchedLevels,
    ClusterDensityCount: bestMatch.matchedLevels.length,
    RiskToDidiPercentage: bestMatch.riskToDidiPct,
    RiskToDidi: bestMatch.riskToDidiPct,
    didiPrice: bestMatch.didiPrice,
    clusterLines: bestMatch.matchedBaselines,
    gatekeeperChecks: {
      didNotKnockout: true,
      check1Phase2Diverging: bestMatch.phase2Diverging,
      check2OuterBandPush: true,
      check3OnHtfCluster: true,
      check4Phase3HookedInward: bestMatch.phase3HookedInward,
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

  const primaryMatched =
    detection.matchedHtfLevels.length > 0
      ? detection.matchedHtfLevels[0]
      : null;

  const activeWallLabel = primaryMatched
    ? detection.matchedHtfLevels.length > 1
      ? `${primaryMatched.label} (+${detection.matchedHtfLevels.length - 1})`
      : primaryMatched.label
    : 'No BB Exit + HTF S/R';

  const wallPrice = primaryMatched ? primaryMatched.price : null;
  const wallProximityPct = primaryMatched ? primaryMatched.distancePct : null;

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
        label: `${tf}-MM20`,
        timeframe: tf,
        upsidePct: signedPct,
      });
    } else if (isShortBias && signedPct < -0.6) {
      m20Candidates.push({
        price: m20,
        label: `${tf}-MM20`,
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
    isActiveSetup && detection.bbExitTimeframe
      ? detection.state === 'STEP 2: REVERSAL CONFIRMED'
        ? `${detection.bbExitTimeframe} BB Exit → Phase 3 Reversal`
        : `${detection.bbExitTimeframe} BB Exit → On ${detection.highestHtfTimeframe} Wall`
      : 'Inside Bollinger Bands / No HTF Match';

  let thesisHeadline = '';
  const reasoningBullets: string[] = [];

  if (isActiveSetup && detection.bbExitTimeframe && detection.highestHtfTimeframe) {
    const exitSideDesc =
      detection.setupSide === 'BUY' ? 'Bottom BB Exit' : 'Top BB Exit';
    const srTypeDesc =
      detection.setupSide === 'BUY' ? 'Support' : 'Resistance';
    const levelList = detection.matchedHtfLevels
      .slice(0, 4)
      .map((l) => `${l.label} (${fmtNum(l.price, category)})`)
      .join(' + ');

    thesisHeadline = `${detection.setupSide} • ${detection.bbExitTimeframe} ${exitSideDesc} + ${detection.highestHtfTimeframe} ${srTypeDesc} [${levelList}]`;

    reasoningBullets.push(
      `Bollinger Band Exit: Price exited the ${
        detection.setupSide === 'BUY' ? 'Lower' : 'Upper'
      } Bollinger Band on the ${detection.bbExitTimeframe} timeframe.`
    );
    reasoningBullets.push(
      `Higher-Timeframe ${srTypeDesc} (${detection.ClusterDensityCount} matched level${
        detection.ClusterDensityCount > 1 ? 's' : ''
      } > ${detection.bbExitTimeframe}): ${levelList}.`
    );
    reasoningBullets.push(
      `Confidence Score: ${detection.setupConfidenceScore}/100 (Timeframes: ${detection.scoreBreakdown.timeframePts}/30 · S/R Count: ${detection.scoreBreakdown.srCountPts}/30 [${detection.ClusterDensityCount} level${
        detection.ClusterDensityCount > 1 ? 's' : ''
      } across ${detection.scoreBreakdown.distinctHtfCount} HTF${
        detection.scoreBreakdown.distinctHtfCount > 1 ? 's' : ''
      }] · Earliness to Didi: ${detection.scoreBreakdown.earlinessPts}/20 · BB Divergence: ${detection.scoreBreakdown.bbDivergencePts}/20 [${
        detection.scoreBreakdown.bbExpansionPct >= 0 ? '+' : ''
      }${detection.scoreBreakdown.bbExpansionPct.toFixed(1)}% BW]).`
    );
    reasoningBullets.push(
      `Didi Stop-Loss: ${fmtNum(
        detection.didiPrice,
        category
      )} (${detection.RiskToDidiPercentage.toFixed(2)}% Risk to Didi).`
    );
  } else {
    thesisHeadline =
      'NO SETUP — Price is not exiting a Bollinger Band onto a Higher-Timeframe Support/Resistance (SAR, MM7, MM20, Jack, Oggy).';
    reasoningBullets.push(
      'Requires: (1) Price exiting Lower or Upper Bollinger Band on D, W, M, 3M, or 6M, combined with (2) an unbroken Support or Resistance (SAR, MM7, MM20, Jack, or Oggy) on a strictly higher timeframe.'
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
    bbExitTimeframe: detection.bbExitTimeframe,
    highestHtfTimeframe: detection.highestHtfTimeframe,
    setupHierarchyRank: detection.setupHierarchyRank,
    setupConfidenceScore: detection.setupConfidenceScore,
    scoreBreakdown: detection.scoreBreakdown,
    matchedHtfLevels: detection.matchedHtfLevels,
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
