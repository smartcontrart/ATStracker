import { flattenTimeframeBaselines } from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  DidiTarget,
  MacroTargetTP2,
  ScreenerResult,
  SetupDirection,
  Timeframe,
  TimeframeATSData,
  TimeframeHorizonSummary,
} from '../types/ats.ts';

const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  D: 0.5,
  W: 1.0,
  M: 1.45,
  '3M': 1.9,
  '6M': 2.35,
  '12M': 2.8,
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

function buildHorizonMatrix(
  timeframes: Record<Timeframe, TimeframeATSData>,
  livePrice: number
): Record<Timeframe, TimeframeHorizonSummary> {
  const matrix = {} as Record<Timeframe, TimeframeHorizonSummary>;

  for (const tf of ALL_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const lines = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy);

    const greenLines: string[] = [];
    const redLines: string[] = [];
    const wallTouches: TimeframeHorizonSummary['wallTouches'] = [];

    for (const l of lines) {
      const shortName = SHORT_KEY_LABELS[l.key] || l.key;
      if (l.polarity === 'GREEN') {
        greenLines.push(shortName);
      } else {
        redLines.push(shortName);
      }

      const absDist = (Math.abs(livePrice - l.price) / livePrice) * 100;
      if (absDist <= 1.0) {
        wallTouches.push({
          shortName,
          label: l.label,
          polarity: l.polarity,
          price: l.price,
          absDistancePct: absDist,
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
      greenLines,
      redLines,
      wallTouches,
      bbState,
      sarState,
      m20Price: tfData.latestBB?.mid ?? null,
    };
  }

  return matrix;
}

function computeClusterStrength(lines: ATSBaseline[], livePrice: number): number {
  let strength = 0;
  for (const l of lines) {
    const absDistPct = (Math.abs(livePrice - l.price) / livePrice) * 100;
    strength += TIMEFRAME_WEIGHTS[l.timeframe] * 12 + (1 - Math.min(absDistPct, 1)) * 5;
  }
  return strength;
}

/**
 * Evaluates bidirectional ATS "Setup 1-2-3-4" Sniper logic:
 * - LONG: Price dropping within 1% above a confluent HTF GREEN Support Wall
 * - SHORT: Price rallying within 1% below a confluent HTF RED Resistance Wall
 * Also generates full per-horizon indicator summaries and human-readable reasoning.
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

  // Collect all GREEN supports and RED resistances across Higher Timeframes (W, M, 3M, 6M, 12M)
  const htfGreenSupports: ATSBaseline[] = [];
  const htfRedResistances: ATSBaseline[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const lines = flattenTimeframeBaselines(
      timeframes[tf].Jack,
      timeframes[tf].Oggy
    );
    for (const line of lines) {
      if (line.polarity === 'GREEN' && livePrice >= line.price) {
        htfGreenSupports.push(line);
      } else if (line.polarity === 'RED' && livePrice < line.price) {
        htfRedResistances.push(line);
      }
    }
  }

  const nearestGreenSupport =
    htfGreenSupports.length > 0
      ? [...htfGreenSupports].sort(
          (a, b) =>
            Math.abs(livePrice - a.price) - Math.abs(livePrice - b.price)
        )[0]
      : null;

  const nearestRedResistance =
    htfRedResistances.length > 0
      ? [...htfRedResistances].sort(
          (a, b) =>
            Math.abs(a.price - livePrice) - Math.abs(b.price - livePrice)
        )[0]
      : null;

  // 1% proximity walls (measured relative to livePrice / baseline)
  const confluentWallLines = htfGreenSupports
    .filter((l) => ((livePrice - l.price) / l.price) * 100 <= 1.0)
    .sort((a, b) => {
      const sA = TIMEFRAME_WEIGHTS[a.timeframe] * 10 - a.distancePct * 4;
      const sB = TIMEFRAME_WEIGHTS[b.timeframe] * 10 - b.distancePct * 4;
      return sB - sA;
    });

  const confluentResistanceLines = htfRedResistances
    .filter((l) => ((l.price - livePrice) / livePrice) * 100 <= 1.0)
    .sort((a, b) => {
      const distA = ((a.price - livePrice) / livePrice) * 100;
      const distB = ((b.price - livePrice) / livePrice) * 100;
      const sA = TIMEFRAME_WEIGHTS[a.timeframe] * 10 - distA * 4;
      const sB = TIMEFRAME_WEIGHTS[b.timeframe] * 10 - distB * 4;
      return sB - sA;
    });

  const isAtSupportWall = confluentWallLines.length > 0;
  const isAtResistanceWall = confluentResistanceLines.length > 0;
  const isAtWall = isAtSupportWall || isAtResistanceWall;

  // Determine primary Setup Direction (LONG at Support Wall vs SHORT at Resistance Wall)
  let direction: SetupDirection = 'NEUTRAL';
  if (isAtSupportWall && isAtResistanceWall) {
    const supStrength = computeClusterStrength(confluentWallLines, livePrice);
    const resStrength = computeClusterStrength(
      confluentResistanceLines,
      livePrice
    );
    direction = supStrength >= resStrength ? 'LONG' : 'SHORT';
  } else if (isAtSupportWall) {
    direction = 'LONG';
  } else if (isAtResistanceWall) {
    direction = 'SHORT';
  }

  const activeCluster =
    direction === 'SHORT' ? confluentResistanceLines : confluentWallLines;
  const primaryWall = activeCluster.length > 0 ? activeCluster[0] : null;

  // Fallback nearest HTF line when NEUTRAL (outside 1% wall)
  const nearestAnyLine = (() => {
    if (nearestGreenSupport && nearestRedResistance) {
      const dSup = Math.abs(livePrice - nearestGreenSupport.price) / livePrice;
      const dRes = Math.abs(nearestRedResistance.price - livePrice) / livePrice;
      return dSup <= dRes ? nearestGreenSupport : nearestRedResistance;
    }
    return nearestGreenSupport ?? nearestRedResistance;
  })();

  const activeWallLabel = primaryWall
    ? activeCluster.length > 1
      ? `${primaryWall.label} (+${activeCluster.length - 1})`
      : primaryWall.label
    : nearestAnyLine
    ? `${nearestAnyLine.label} (${(
        (Math.abs(livePrice - nearestAnyLine.price) / livePrice) *
        100
      ).toFixed(1)}%)`
    : 'No HTF Baseline';

  const wallPrice = primaryWall
    ? primaryWall.price
    : nearestAnyLine?.price ?? null;

  const wallProximityPct =
    wallPrice !== null
      ? (Math.abs(livePrice - wallPrice) / livePrice) * 100
      : null;

  // Stop Loss: 1% below Support Wall for LONG, 1% above Resistance Wall for SHORT
  const isShortBias =
    direction === 'SHORT' ||
    (direction === 'NEUTRAL' && nearestAnyLine?.polarity === 'RED');

  const refWall = wallPrice ?? livePrice;
  const stopLoss = isShortBias ? refWall * 1.01 : refWall * 0.99;
  const riskAmount = Math.max(
    Math.abs(livePrice - stopLoss),
    livePrice * 0.005
  );
  const riskPct = (Math.abs(livePrice - stopLoss) / livePrice) * 100;

  // Step 2 (Didi - TP1): Overhead Didi for LONG, Downside Didi for SHORT
  const effectiveTargetTP1 = isShortBias ? downsideDidi : Didi;
  const step2Didi = Boolean(
    effectiveTargetTP1 && effectiveTargetTP1.upsidePct > 0.1
  );

  const rewardAmount = effectiveTargetTP1
    ? Math.abs(effectiveTargetTP1.price - livePrice)
    : 0;
  const riskRewardRatio =
    effectiveTargetTP1 && riskAmount > 0 ? rewardAmount / riskAmount : null;

  // Step 3 (Volatility Reversal): Opposite Bollinger Band curving inwards
  const curvingTfs = (['D', 'W', 'M'] as const).filter(
    (tf) => timeframes[tf].oppositeBandCurvingInwards
  );
  const step3VolatilityReversal = curvingTfs.length > 0;

  let volatilitySignal = 'Bands Expanding';
  if (curvingTfs.length > 0) {
    volatilitySignal = `${curvingTfs.join(' + ')} Opp. BB Curving In`;
  } else if (timeframes.D.bbCompressing) {
    volatilitySignal = 'D Bandwidth Contracting';
  }

  // Step 4 (Macro Target - TP2): Higher Timeframe M20 (overhead for LONG, below for SHORT)
  const directionalM20s: MacroTargetTP2[] = [];
  const allHtfM20s: MacroTargetTP2[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const bb = timeframes[tf].latestBB;
    if (bb && bb.mid > 0) {
      const signedPct = ((bb.mid - livePrice) / livePrice) * 100;
      const item: MacroTargetTP2 = {
        price: bb.mid,
        label: `${tf}-M20`,
        timeframe: tf,
        upsidePct: signedPct,
      };
      allHtfM20s.push(item);

      if (!isShortBias && bb.mid > livePrice * 1.002) {
        directionalM20s.push(item);
      } else if (isShortBias && bb.mid < livePrice * 0.998) {
        directionalM20s.push(item);
      }
    }
  }

  let macroTargetTP2: MacroTargetTP2 | null = null;
  if (directionalM20s.length > 0) {
    directionalM20s.sort(
      (a, b) => Math.abs(a.upsidePct) - Math.abs(b.upsidePct)
    );
    macroTargetTP2 = directionalM20s[0];
  } else if (allHtfM20s.length > 0) {
    allHtfM20s.sort((a, b) => Math.abs(a.upsidePct) - Math.abs(b.upsidePct));
    macroTargetTP2 = allHtfM20s[0];
  }

  const trendAlignedHTF = !isShortBias
    ? Boolean(
        timeframes.W.Jack.Jack_0?.polarity === 'GREEN' &&
          timeframes.M.Jack.Jack_0?.polarity === 'GREEN'
      )
    : Boolean(
        timeframes.W.Jack.Jack_0?.polarity === 'RED' &&
          timeframes.M.Jack.Jack_0?.polarity === 'RED'
      );

  const step4MacroM20 = Boolean(
    directionalM20s.length > 0 || (macroTargetTP2 && trendAlignedHTF)
  );

  // Setup Step 1-2-3-4
  let setupStep: 0 | 1 | 2 | 3 | 4 = 0;
  if (isAtWall) {
    setupStep = 1;
    if (step2Didi) {
      setupStep = 2;
      if (step3VolatilityReversal) {
        setupStep = 3;
        if (step4MacroM20) {
          setupStep = 4;
        }
      }
    }
  }

  // Quantitative Confidence Score (0 - 100%)
  let rawScore = 0;
  if (isAtWall && primaryWall && wallProximityPct !== null) {
    const maxTfWeight = Math.max(
      ...activeCluster.map((l) => TIMEFRAME_WEIGHTS[l.timeframe])
    );
    const tfBaseScore = 16 + ((maxTfWeight - 1.0) / 1.8) * 22; // 16..38
    const tightnessBonus = (1 - Math.min(wallProximityPct, 1)) * 8; // 0..8
    rawScore += tfBaseScore + tightnessBonus;

    let confluenceBonus = 0;
    for (let i = 1; i < activeCluster.length; i++) {
      confluenceBonus += 4.5 * TIMEFRAME_WEIGHTS[activeCluster[i].timeframe];
    }
    const hasJack = activeCluster.some((l) => l.family === 'Jack');
    const hasOggy = activeCluster.some((l) => l.family === 'Oggy');
    if (hasJack && hasOggy) confluenceBonus += 4;
    rawScore += Math.min(24, confluenceBonus);
  } else if (nearestAnyLine && wallProximityPct !== null && wallProximityPct <= 5.0) {
    const factor = 1 - (wallProximityPct - 1.0) / 4.0;
    const tfFactor = TIMEFRAME_WEIGHTS[nearestAnyLine.timeframe] / 2.8;
    rawScore += Math.max(2, factor * (14 + tfFactor * 8));
  } else if (nearestAnyLine) {
    rawScore += 4;
  }

  if (step3VolatilityReversal) {
    rawScore += curvingTfs.length >= 2 ? 11 : 8;
  } else if (timeframes.D.bbCompressing) {
    rawScore += 4;
  }

  const sarAligned = !isShortBias
    ? timeframes.D.sarFlippedBullishRecently ||
      timeframes.W.sarFlippedBullishRecently
      ? 5
      : timeframes.D.latestSAR?.isBullish
      ? 3
      : 0
    : timeframes.D.sarFlippedBearishRecently ||
      timeframes.W.sarFlippedBearishRecently
    ? 5
    : timeframes.D.latestSAR && !timeframes.D.latestSAR.isBullish
    ? 3
    : 0;
  rawScore += sarAligned;

  if (step2Didi && riskRewardRatio !== null) {
    if (riskRewardRatio >= 3.0) rawScore += 8;
    else if (riskRewardRatio >= 2.0) rawScore += 6;
    else if (riskRewardRatio >= 1.2) rawScore += 4;
    else rawScore += 2;
  }

  if (step4MacroM20) rawScore += 6;

  const confidenceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Build Clear Quantitative Reasoning ("Why It's a Candidate")
  const totalHTFGreen = htfGreenSupports.length;
  const totalHTFRed = htfRedResistances.length;
  const totalHTFLines = totalHTFGreen + totalHTFRed;

  const tfBreakdownText = HIGHER_TIMEFRAMES.map((tf) => {
    const h = horizonMatrix[tf];
    return `${tf}: ${h.greenCount}G/${h.redCount}R`;
  }).join(' · ');

  let thesisHeadline = '';
  const reasoningBullets: string[] = [];

  if (direction === 'LONG' && primaryWall) {
    const wallList = confluentWallLines
      .slice(0, 4)
      .map(
        (l) =>
          `${l.label} (${fmtNum(l.price, category)}, +${l.distancePct.toFixed(2)}%)`
      )
      .join(', ');

    thesisHeadline =
      confluentWallLines.length > 1
        ? `LONG Support Confluence: ${confluentWallLines.length} HTF Green lines (${confluentWallLines
            .slice(0, 3)
            .map((l) => l.label)
            .join(' + ')}) holding within ${(wallProximityPct ?? 0).toFixed(2)}%`
        : `LONG Support Test on ${primaryWall.label} (${(
            wallProximityPct ?? 0
          ).toFixed(2)}% above Green floor)`;

    reasoningBullets.push(`Active Green Support Wall: ${wallList}.`);
    if (isAtResistanceWall) {
      reasoningBullets.push(
        `Tight MTF Squeeze: Also within 1% below Red Resistance (${confluentResistanceLines
          .map((l) => l.label)
          .join(', ')}) — watch for compression breakout.`
      );
    }
  } else if (direction === 'SHORT' && primaryWall) {
    const resList = confluentResistanceLines
      .slice(0, 4)
      .map(
        (l) =>
          `${l.label} (${fmtNum(l.price, category)}, ${(
            ((l.price - livePrice) / livePrice) *
            100
          ).toFixed(2)}% overhead)`
      )
      .join(', ');

    thesisHeadline =
      confluentResistanceLines.length > 1
        ? `SHORT Resistance Rejection: ${confluentResistanceLines.length} HTF Red ceilings (${confluentResistanceLines
            .slice(0, 3)
            .map((l) => l.label)
            .join(' + ')}) capping price within ${(wallProximityPct ?? 0).toFixed(2)}%`
        : `SHORT Resistance Test under ${primaryWall.label} (${(
            wallProximityPct ?? 0
          ).toFixed(2)}% below Red ceiling)`;

    reasoningBullets.push(`Active Red Resistance Wall: ${resList}.`);
    if (isAtSupportWall) {
      reasoningBullets.push(
        `Tight MTF Squeeze: Simultaneously resting near Green Support (${confluentWallLines
          .map((l) => l.label)
          .join(', ')}).`
      );
    }
  } else {
    thesisHeadline = nearestAnyLine
      ? `Mid-Range Watch: ${(wallProximityPct ?? 0).toFixed(
          2
        )}% away from nearest HTF ${
          nearestAnyLine.polarity === 'GREEN' ? 'Green Support' : 'Red Resistance'
        } (${nearestAnyLine.label})`
      : 'Insufficient Higher-Timeframe lookback bars for wall detection';

    if (nearestGreenSupport) {
      reasoningBullets.push(
        `Nearest Green Support Floor: ${nearestGreenSupport.label} @ ${fmtNum(
          nearestGreenSupport.price,
          category
        )} (${nearestGreenSupport.distancePct.toFixed(2)}% below).`
      );
    }
    if (nearestRedResistance) {
      reasoningBullets.push(
        `Nearest Red Resistance Ceiling: ${
          nearestRedResistance.label
        } @ ${fmtNum(nearestRedResistance.price, category)} (+${(
          ((nearestRedResistance.price - livePrice) / livePrice) *
          100
        ).toFixed(2)}% above).`
      );
    }
  }

  reasoningBullets.push(
    `Multi-Horizon Polarity (${totalHTFGreen}/${totalHTFLines} HTF Green Supports vs ${totalHTFRed}/${totalHTFLines} Red Resistances) — ${tfBreakdownText} | D: ${horizonMatrix.D.greenCount}G/${horizonMatrix.D.redCount}R.`
  );

  const sarSummary = `D-SAR: ${horizonMatrix.D.sarState}, W-SAR: ${horizonMatrix.W.sarState}`;
  reasoningBullets.push(
    `Volatility & SAR State: ${volatilitySignal} (${sarSummary}).`
  );

  if (effectiveTargetTP1) {
    reasoningBullets.push(
      `Risk/Reward Geometry: Stop Loss @ ${fmtNum(stopLoss, category)} (${riskPct.toFixed(
        2
      )}% risk) → TP1 Didi @ ${effectiveTargetTP1.label} (${fmtNum(
        effectiveTargetTP1.price,
        category
      )}, ${isShortBias ? '-' : '+'}${effectiveTargetTP1.upsidePct.toFixed(
        2
      )}%)${
        riskRewardRatio !== null
          ? ` for ${riskRewardRatio.toFixed(2)}x R:R`
          : ''
      }${
        macroTargetTP2
          ? `; Macro TP2 @ ${macroTargetTP2.label} (${fmtNum(
              macroTargetTP2.price,
              category
            )})`
          : ''
      }.`
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
    isAtWall,
    isAtSupportWall,
    isAtResistanceWall,
    activeWallLabel,
    wallPrice,
    wallProximityPct,
    confluentWallLines,
    confluentResistanceLines,
    nearestGreenSupport,
    nearestRedResistance,
    confidenceScore,
    setupStep,
    stepFlags: {
      step1Wall: isAtWall,
      step2Didi,
      step3VolatilityReversal,
      step4MacroM20,
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
