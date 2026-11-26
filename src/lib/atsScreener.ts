import { flattenTimeframeBaselines } from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  DidiTarget,
  MacroTargetTP2,
  OHLCVBar,
  ScreenerResult,
  SetupConfirmationStatus,
  SetupDirection,
  Timeframe,
  TimeframeATSData,
  TimeframeHorizonSummary,
  TradeActionOutput,
} from '../types/ats.ts';

/**
 * Pillar 1 Point Schedule per Higher-Timeframe line within 1% margin:
 * - Weekly (W): 10 points per line
 * - Monthly (M) or Quarterly (3M): 15 points per line
 * - Bi-Annual (6M) or Annual (12M): 20 points per line
 * Capped at 60 points maximum.
 */
export const CLUSTER_POINTS_BY_TIMEFRAME: Record<Timeframe, number> = {
  D: 0,
  W: 10,
  M: 15,
  '3M': 15,
  '6M': 20,
  '12M': 20,
};

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

/**
 * Maps a Final Score (0..100) and setup direction to the exact Trade Action Output:
 * - 85 to 100: "STRONG BUY" or "STRONG SELL"
 * - 70 to 84:  "BUY" or "SELL"
 * - 40 to 69:  "WATCHLIST"
 * - 0 to 39:   "IGNORE / INVALIDATED"
 */
export function mapScoreToTradeAction(
  finalScore: number,
  direction: SetupDirection,
  isKnockedOut: boolean
): TradeActionOutput {
  if (isKnockedOut || direction === 'NEUTRAL' || finalScore < 40) {
    return 'IGNORE / INVALIDATED';
  }
  if (finalScore >= 85) {
    return direction === 'SHORT' ? 'STRONG SELL' : 'STRONG BUY';
  }
  if (finalScore >= 70) {
    return direction === 'SHORT' ? 'SELL' : 'BUY';
  }
  return 'WATCHLIST';
}

/**
 * Instant (0ms) selector for Mode A (Aggressive — Toggle OFF) vs Mode B (Conservative — Toggle ON).
 */
export function resolveExecutionModeResult(
  row: ScreenerResult,
  requirePhase3Confirmation: boolean
): {
  finalScore: number;
  tradeAction: TradeActionOutput;
  phase3PenaltyApplied: boolean;
} {
  if (!requirePhase3Confirmation) {
    return {
      finalScore: row.baseScore,
      tradeAction: row.tradeActionAggressive,
      phase3PenaltyApplied: false,
    };
  }
  return {
    finalScore: row.conservativeScore,
    tradeAction: row.tradeActionConservative,
    phase3PenaltyApplied:
      !row.isKnockedOut && row.baseScore > 0 && !row.isPhase3,
  };
}

function buildHorizonMatrix(
  timeframes: Record<Timeframe, TimeframeATSData>,
  livePrice: number
): Record<Timeframe, TimeframeHorizonSummary> {
  const matrix = {} as Record<Timeframe, TimeframeHorizonSummary>;

  for (const tf of ALL_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const allLines = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy, false);
    const unpiercedLines = allLines.filter((l) => !l.isPierced);
    const piercedCount = allLines.length - unpiercedLines.length;

    const greenLines: string[] = [];
    const redLines: string[] = [];
    const wallTouches: TimeframeHorizonSummary['wallTouches'] = [];

    for (const l of unpiercedLines) {
      const shortName = SHORT_KEY_LABELS[l.key] || l.key;
      if (l.polarity === 'GREEN') {
        greenLines.push(shortName);
      } else {
        redLines.push(shortName);
      }

      const absMarginPct = (Math.abs(livePrice - l.price) / l.price) * 100;
      if (absMarginPct <= 1.0) {
        wallTouches.push({
          shortName,
          label: l.label,
          polarity: l.polarity,
          price: l.price,
          absDistancePct: absMarginPct,
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
 * Evaluates Didi Stop-Loss & Knockout Rule for a Buying Setup (symmetric to Selling):
 * - Didi = the absolute lowest price reached during the current drop (from the recent swing peak).
 * - Knockout Rule: if a prior bar in the drop already established a Didi bottom at the cluster
 *   (followed by a bounce attempt) AND currentPrice breaches below that Didi level (or breaks >1%
 *   below all active support cluster lines), the setup is immediately invalidated (Score = 0).
 */
function evaluateDidiAndKnockout(params: {
  isShortSetup: boolean;
  livePrice: number;
  clusterLines: ATSBaseline[];
  swingBars: OHLCVBar[];
}): {
  didiStopPrice: number;
  didiDistancePct: number;
  isKnockedOut: boolean;
  pillar2RiskScore: 0 | 20 | 40;
} {
  const { isShortSetup, livePrice, clusterLines, swingBars } = params;

  if (clusterLines.length === 0 || swingBars.length === 0) {
    return {
      didiStopPrice: livePrice,
      didiDistancePct: 0,
      isKnockedOut: false,
      pillar2RiskScore: 0,
    };
  }

  const windowBars = swingBars.slice(-10);

  if (!isShortSetup) {
    // Buying setup: trace the drop from the highest high in the recent 20-bar window
    let peakIdx = 0;
    for (let i = 1; i < windowBars.length; i++) {
      if (windowBars[i].high > windowBars[peakIdx].high) {
        peakIdx = i;
      }
    }
    const dropBars = windowBars.slice(peakIdx);
    const maxClusterPrice = Math.max(...clusterLines.map((l) => l.price));
    const minClusterPrice = Math.min(...clusterLines.map((l) => l.price));

    // Check if a prior bar in the drop established a Didi swing low at the cluster and bounced,
    // which current livePrice has now breached!
    let establishedDidi: number | null = null;
    for (let m = 0; m < dropBars.length - 1; m++) {
      const candidateLow = dropBars[m].low;
      if (candidateLow <= maxClusterPrice * 1.015) {
        // Did any subsequent bar before today bounce above candidateLow?
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
          (establishedDidi === null || candidateLow < establishedDidi)
        ) {
          establishedDidi = candidateLow;
        }
      }
    }

    const breachedClusterFloor = livePrice < minClusterPrice * 0.99;
    if (
      (establishedDidi !== null && livePrice < establishedDidi) ||
      breachedClusterFloor
    ) {
      const koDidi = establishedDidi ?? minClusterPrice * 0.99;
      return {
        didiStopPrice: koDidi,
        didiDistancePct: ((Math.abs(livePrice - koDidi) / koDidi) * 100),
        isKnockedOut: true,
        pillar2RiskScore: 0,
      };
    }

    const didiStopPrice = Math.min(...dropBars.map((b) => b.low), livePrice);
    const didiDistancePct =
      didiStopPrice > 0
        ? ((livePrice - didiStopPrice) / didiStopPrice) * 100
        : 0;

    const pillar2RiskScore: 0 | 20 | 40 =
      didiDistancePct <= 0.5 ? 40 : didiDistancePct <= 1.5 ? 20 : 0;

    return {
      didiStopPrice,
      didiDistancePct,
      isKnockedOut: false,
      pillar2RiskScore,
    };
  } else {
    // Selling setup: trace the rally from the lowest low in the recent 20-bar window
    let troughIdx = 0;
    for (let i = 1; i < windowBars.length; i++) {
      if (windowBars[i].low < windowBars[troughIdx].low) {
        troughIdx = i;
      }
    }
    const rallyBars = windowBars.slice(troughIdx);
    const minClusterPrice = Math.min(...clusterLines.map((l) => l.price));
    const maxClusterPrice = Math.max(...clusterLines.map((l) => l.price));

    let establishedDidi: number | null = null;
    for (let m = 0; m < rallyBars.length - 1; m++) {
      const candidateHigh = rallyBars[m].high;
      if (candidateHigh >= minClusterPrice * 0.985) {
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
          (establishedDidi === null || candidateHigh > establishedDidi)
        ) {
          establishedDidi = candidateHigh;
        }
      }
    }

    const breachedClusterCeiling = livePrice > maxClusterPrice * 1.01;
    if (
      (establishedDidi !== null && livePrice > establishedDidi) ||
      breachedClusterCeiling
    ) {
      const koDidi = establishedDidi ?? maxClusterPrice * 1.01;
      return {
        didiStopPrice: koDidi,
        didiDistancePct: ((Math.abs(koDidi - livePrice) / livePrice) * 100),
        isKnockedOut: true,
        pillar2RiskScore: 0,
      };
    }

    const didiStopPrice = Math.max(...rallyBars.map((b) => b.high), livePrice);
    const didiDistancePct =
      livePrice > 0 ? ((didiStopPrice - livePrice) / livePrice) * 100 : 0;

    const pillar2RiskScore: 0 | 20 | 40 =
      didiDistancePct <= 0.5 ? 40 : didiDistancePct <= 1.5 ? 20 : 0;

    return {
      didiStopPrice,
      didiDistancePct,
      isKnockedOut: false,
      pillar2RiskScore,
    };
  }
}

/**
 * Evaluates the exact AT.S Cluster + Didi Risk Confidence Score (out of 100):
 * 1. Base Score = Pillar 1 Cluster (max 60) + Pillar 2 Didi Proximity Risk (max 40),
 *    with immediate Knockout to 0 if currentPrice breaches Didi.
 * 2. Mode A (Aggressive — Toggle OFF): Final Score = Base Score.
 * 3. Mode B (Conservative — Toggle ON): Final Score = Base Score if Phase 3 confirmed,
 *    else max(0, Base Score - 25).
 * 4. Maps Final Score to STRONG BUY/SELL (85-100), BUY/SELL (70-84), WATCHLIST (40-69),
 *    or IGNORE / INVALIDATED (0-39).
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

  // Collect all active (unpierced) Higher-Timeframe Green Jack/Oggy Supports & Red Jack/Oggy Resistances
  const htfGreenBaselines: ATSBaseline[] = [];
  const htfRedBaselines: ATSBaseline[] = [];
  const buyClusterLines: ATSBaseline[] = [];
  const sellClusterLines: ATSBaseline[] = [];

  let rawBuyClusterPts = 0;
  let rawSellClusterPts = 0;

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const ptsPerLine = CLUSTER_POINTS_BY_TIMEFRAME[tf];
    const unpierced = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy, true);

    for (const line of unpierced) {
      const marginPct = Math.abs(livePrice - line.price) / line.price;
      if (line.polarity === 'GREEN') {
        htfGreenBaselines.push(line);
        if (marginPct <= 0.01) {
          buyClusterLines.push(line);
          rawBuyClusterPts += ptsPerLine;
        }
      } else {
        htfRedBaselines.push(line);
        if (marginPct <= 0.01) {
          sellClusterLines.push(line);
          rawSellClusterPts += ptsPerLine;
        }
      }
    }
  }

  // Sort cluster lines by highest timeframe points first, then closest to livePrice
  const sortClusterLines = (lines: ATSBaseline[]) =>
    [...lines].sort((a, b) => {
      const diffPts =
        CLUSTER_POINTS_BY_TIMEFRAME[b.timeframe] -
        CLUSTER_POINTS_BY_TIMEFRAME[a.timeframe];
      if (diffPts !== 0) return diffPts;
      return Math.abs(livePrice - a.price) - Math.abs(livePrice - b.price);
    });

  const sortedBuyCluster = sortClusterLines(buyClusterLines);
  const sortedSellCluster = sortClusterLines(sellClusterLines);

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

  // Step 0: Identify whether evaluating a Buying setup or a Selling setup
  let direction: SetupDirection = 'NEUTRAL';
  if (rawBuyClusterPts > 0 && rawSellClusterPts > 0) {
    if (rawBuyClusterPts !== rawSellClusterPts) {
      direction = rawBuyClusterPts > rawSellClusterPts ? 'LONG' : 'SHORT';
    } else {
      const bestBuyDist = Math.abs(livePrice - sortedBuyCluster[0].price);
      const bestSellDist = Math.abs(sortedSellCluster[0].price - livePrice);
      direction = bestBuyDist <= bestSellDist ? 'LONG' : 'SHORT';
    }
  } else if (rawBuyClusterPts > 0) {
    direction = 'LONG';
  } else if (rawSellClusterPts > 0) {
    direction = 'SHORT';
  }

  const isShortSetup = direction === 'SHORT';
  const activeClusterLines =
    direction === 'LONG'
      ? sortedBuyCluster
      : direction === 'SHORT'
      ? sortedSellCluster
      : [];

  // Pillar 1: The Support/Resistance Cluster (Max 60 Points)
  const pillar1ClusterScore =
    direction === 'LONG'
      ? Math.min(60, rawBuyClusterPts)
      : direction === 'SHORT'
      ? Math.min(60, rawSellClusterPts)
      : 0;

  // Choose consistent daily bars (falling back to primary timeframe bars in synthetic unit tests)
  const dBars = timeframes.D.bars;
  const dailyConsistent =
    dBars.length >= 2 &&
    Math.abs(dBars[dBars.length - 1].close - livePrice) <=
      Math.max(0.01, livePrice * 0.03);
  const swingBars = dailyConsistent
    ? dBars
    : activeClusterLines.length > 0
    ? timeframes[activeClusterLines[0].timeframe].bars
    : dBars;

  // Knockout Rule + Pillar 2: Risk Assessment / Proximity to Didi (Max 40 Points)
  const { didiStopPrice, didiDistancePct, isKnockedOut, pillar2RiskScore } =
    evaluateDidiAndKnockout({
      isShortSetup,
      livePrice,
      clusterLines: activeClusterLines,
      swingBars,
    });

  // Base Score out of 100 points (0 if knocked out or no cluster)
  const baseScore =
    isKnockedOut || pillar1ClusterScore === 0
      ? 0
      : Math.min(100, pillar1ClusterScore + pillar2RiskScore);

  // Phase 3 Bollinger Bands Check (Opposite band hooking inward towards price)
  const bbSeries = dailyConsistent
    ? timeframes.D.bollingerBands
    : activeClusterLines.length > 0
    ? timeframes[activeClusterLines[0].timeframe].bollingerBands
    : timeframes.D.bollingerBands;

  const isPhase3 = (() => {
    if (direction === 'NEUTRAL' || bbSeries.length < 2) return false;
    const curr = bbSeries[bbSeries.length - 1];
    const prev = bbSeries[bbSeries.length - 2];
    // Dropping market (Buy): upper band hooks downward towards price
    // Rising market (Sell): lower band hooks upward towards price
    return !isShortSetup ? curr.upper < prev.upper : curr.lower > prev.lower;
  })();

  // Mode B (Conservative): -25 point penalty if NOT in Phase 3 (floored at 0)
  const conservativeScore = isKnockedOut
    ? 0
    : isPhase3
    ? baseScore
    : Math.max(0, baseScore - 25);

  const tradeActionAggressive = mapScoreToTradeAction(
    baseScore,
    direction,
    isKnockedOut
  );
  const tradeActionConservative = mapScoreToTradeAction(
    conservativeScore,
    direction,
    isKnockedOut
  );

  const isAtSupportWall =
    direction === 'LONG' && !isKnockedOut && activeClusterLines.length > 0;
  const isAtResistanceWall =
    direction === 'SHORT' && !isKnockedOut && activeClusterLines.length > 0;
  const isAtWall = isAtSupportWall || isAtResistanceWall;

  const primaryLine = activeClusterLines.length > 0 ? activeClusterLines[0] : null;
  const nearestAnyLine = (() => {
    if (nearestGreenSupport && nearestRedResistance) {
      const dSup = Math.abs(livePrice - nearestGreenSupport.price);
      const dRes = Math.abs(nearestRedResistance.price - livePrice);
      return dSup <= dRes ? nearestGreenSupport : nearestRedResistance;
    }
    return nearestGreenSupport ?? nearestRedResistance;
  })();

  const activeWallLabel = primaryLine
    ? activeClusterLines.length > 1
      ? `${primaryLine.label} (+${activeClusterLines.length - 1})`
      : primaryLine.label
    : nearestAnyLine
    ? `${nearestAnyLine.label} (${(
        (Math.abs(livePrice - nearestAnyLine.price) / nearestAnyLine.price) *
        100
      ).toFixed(1)}%)`
    : 'No HTF Cluster';

  const wallPrice = primaryLine
    ? primaryLine.price
    : nearestAnyLine?.price ?? null;

  const wallProximityPct =
    wallPrice !== null
      ? (Math.abs(livePrice - wallPrice) / wallPrice) * 100
      : null;

  const isShortBias =
    direction === 'SHORT' ||
    (direction === 'NEUTRAL' && nearestAnyLine?.polarity === 'RED');

  // Stop-loss anchored at Didi (ensuring strict < livePrice for Buy / > livePrice for Sell if exact tie)
  const stopLoss = !isShortBias
    ? didiStopPrice < livePrice
      ? didiStopPrice
      : didiStopPrice * 0.998
    : didiStopPrice > livePrice
    ? didiStopPrice
    : didiStopPrice * 1.002;

  const riskAmount = Math.max(
    Math.abs(livePrice - stopLoss),
    livePrice * 0.002
  );
  const riskPct = didiDistancePct;

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
  } else if (timeframes.W.latestSMA20) {
    const wM20 = timeframes.W.latestSMA20.value;
    macroTargetTP2 = {
      price: wM20,
      label: 'W-M20',
      timeframe: 'W',
      upsidePct: ((wM20 - livePrice) / livePrice) * 100,
    };
  }

  const liveReward =
    macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.4
      ? Math.abs(macroTargetTP2.price - livePrice)
      : effectiveTargetTP1
      ? Math.abs(effectiveTargetTP1.price - livePrice)
      : 0;

  const riskRewardRatio =
    liveReward > 0 && riskAmount > 0 ? liveReward / riskAmount : null;

  // Sequential Step progress (1: Cluster, 2: Didi Risk <= 1.5%, 3: Phase 3 Confirmed, 4: M20 Target Open)
  let setupStep: 0 | 1 | 2 | 3 | 4 = 0;
  if (isAtWall) {
    setupStep = 1;
    if (pillar2RiskScore > 0) {
      setupStep = 2;
      if (isPhase3) {
        setupStep = 3;
        if (macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.6) {
          setupStep = 4;
        }
      }
    }
  }

  const volatilitySignal = isPhase3
    ? 'Phase 3 Confirmed (Opposite BB hooking inward)'
    : 'Phase 2 Widening (-25 pts in Conservative Mode)';

  let signalStatus: SetupConfirmationStatus = 'WATCH';
  if (isAtWall && baseScore >= 40) {
    signalStatus = isPhase3 ? 'CONFIRMED' : 'CANDIDATE';
  }

  // Clear, transparent breakdown of Pillar 1 + Pillar 2 + Phase 3
  let thesisHeadline = '';
  const reasoningBullets: string[] = [];

  if (isKnockedOut) {
    thesisHeadline = `IGNORE / INVALIDATED — Knockout Rule: Current price (${fmtNum(
      livePrice,
      category
    )}) breached Didi stop-loss (${fmtNum(didiStopPrice, category)}) → Score = 0`;
    reasoningBullets.push(
      `Knockout Rule Triggered: Price breached Didi (${fmtNum(
        didiStopPrice,
        category
      )}), immediately invalidating the setup (0/100).`
    );
  } else if (activeClusterLines.length > 0) {
    const clusterSummary = activeClusterLines
      .slice(0, 4)
      .map(
        (l) =>
          `${l.label} (${fmtNum(l.price, category)}, +${
            CLUSTER_POINTS_BY_TIMEFRAME[l.timeframe]
          }pt)`
      )
      .join(' + ');

    thesisHeadline = `${tradeActionAggressive} (Base ${baseScore}/100 | Mode B ${conservativeScore}/100) — Cluster ${pillar1ClusterScore}/60 + Didi Risk ${pillar2RiskScore}/40 (${didiDistancePct.toFixed(
      2
    )}% to Didi)`;

    reasoningBullets.push(
      `Pillar 1 — Cluster (${pillar1ClusterScore}/60 pts): ${
        activeClusterLines.length
      } active ${
        direction === 'SHORT' ? 'Red resistance' : 'Green support'
      } line(s) within 1% — ${clusterSummary}.`
    );
    reasoningBullets.push(
      `Pillar 2 — Proximity to Didi (${pillar2RiskScore}/40 pts): Current price (${fmtNum(
        livePrice,
        category
      )}) is ${didiDistancePct.toFixed(2)}% from Didi stop-loss (${fmtNum(
        didiStopPrice,
        category
      )}).`
    );
    reasoningBullets.push(
      `Execution Mode — ${volatilitySignal}: Mode A (Aggressive) = ${baseScore}/100 (${tradeActionAggressive}) | Mode B (Conservative) = ${conservativeScore}/100 (${tradeActionConservative}).`
    );
  } else {
    thesisHeadline = nearestAnyLine
      ? `IGNORE / INVALIDATED (0/100) — Floating ${(
          wallProximityPct ?? 0
        ).toFixed(2)}% away from nearest HTF line (${nearestAnyLine.label})`
      : 'IGNORE / INVALIDATED (0/100) — Floating without active HTF cluster levels';
    reasoningBullets.push(
      'Pillar 1 — Cluster (0/60 pts): No active Higher Timeframe Jack/Oggy levels within a 1% margin.'
    );
  }

  return {
    symbol,
    displaySymbol,
    name,
    category,
    livePrice,
    change24hPct,
    direction,
    signalStatus,
    isAtWall,
    isAtSupportWall,
    isAtResistanceWall,
    activeWallLabel,
    wallPrice,
    wallProximityPct,
    confluentWallLines: sortedBuyCluster,
    confluentResistanceLines: sortedSellCluster,
    nearestGreenSupport,
    nearestRedResistance,
    confidenceScore: baseScore,
    baseScore,
    conservativeScore,
    pillar1ClusterScore,
    pillar2RiskScore,
    didiStopPrice,
    didiDistancePct,
    isKnockedOut,
    isPhase3,
    tradeActionAggressive,
    tradeActionConservative,
    setupStep,
    stepFlags: {
      step1Wall: pillar1ClusterScore > 0 && !isKnockedOut,
      step2Didi: pillar2RiskScore > 0 && !isKnockedOut,
      step3VolatilityReversal: isPhase3 && pillar1ClusterScore > 0 && !isKnockedOut,
      step4MacroM20: Boolean(
        isAtWall && macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.6
      ),
    },
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
