import {
  AUTOUR_OVERSHOOT_TOL_PCT,
  computeAutourWeight,
  flattenTimeframeBaselines,
} from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  DidiTarget,
  MacroTargetTP2,
  ScreenerResult,
  SetupConfirmationStatus,
  SetupDirection,
  Timeframe,
  TimeframeATSData,
  TimeframeHorizonSummary,
} from '../types/ats.ts';

const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  D: 0.5,
  W: 1.15,
  M: 1.55,
  '3M': 1.9,
  '6M': 2.25,
  '12M': 2.6,
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

interface MacroWallCandidate {
  label: string;
  timeframe: Timeframe;
  price: number;
  polarity: 'GREEN' | 'RED';
  kind: 'Jack' | 'Oggy' | 'M20' | 'M7' | 'BB' | 'SAR';
  signedApproachPct: number;
  autourZone: 'EXACT' | 'APPROACH' | 'OVERSHOOT_AUTOUR' | 'DISTANT' | 'PIERCED';
  autourWeight: number;
  baselineRef?: ATSBaseline;
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

      const absDist = (Math.abs(livePrice - l.price) / livePrice) * 100;
      if (l.autourWeight >= 0.65 || absDist <= 1.4) {
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
 * Evaluates the full 4-Step Sequential AT.S Protocol + "Autour" Elastic Scoring:
 * - Étape 1: Support / Résistance Macro HTF (BB Inf/Sup, M20, M7, SAR Wilder, Oggy/Jack non-transpercés) avec tolérance "Autour"
 * - Étape 2: Tracé de Dee-Dee (seuil court terme à reconquérir)
 * - Étape 3: Retournement de la BB opposée (Signal Orange -> Signal Vert/Rouge) + reconquête Oggy/Dee-Dee + SL sous le plus bas Étape 1
 * - Étape 4: Objectifs M7 (1ère bille noire) et M20 (2ème bille noire) + validation R:R
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

  // Collect all UNPIERCED Macro Supports & Resistances across Higher Timeframes (1W, 1M, 3M, 6M, 12M)
  const htfGreenBaselines: ATSBaseline[] = [];
  const htfRedBaselines: ATSBaseline[] = [];
  const bullMacroWalls: MacroWallCandidate[] = [];
  const bearMacroWalls: MacroWallCandidate[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const maxOvershoot = AUTOUR_OVERSHOOT_TOL_PCT[tf];

    // 1. Unpierced Oggy & Jack baselines
    const unpierced = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy, true);
    for (const line of unpierced) {
      if (line.polarity === 'GREEN') {
        htfGreenBaselines.push(line);
        if (line.autourWeight >= 0.45) {
          bullMacroWalls.push({
            label: line.label,
            timeframe: tf,
            price: line.price,
            polarity: 'GREEN',
            kind: line.family,
            signedApproachPct: ((livePrice - line.price) / line.price) * 100,
            autourZone: line.autourZone,
            autourWeight: line.autourWeight,
            baselineRef: line,
          });
        }
      } else {
        htfRedBaselines.push(line);
        if (line.autourWeight >= 0.45) {
          bearMacroWalls.push({
            label: line.label,
            timeframe: tf,
            price: line.price,
            polarity: 'RED',
            kind: line.family,
            signedApproachPct: ((line.price - livePrice) / line.price) * 100,
            autourZone: line.autourZone,
            autourWeight: line.autourWeight,
            baselineRef: line,
          });
        }
      }
    }

    // 2. Dynamic HTF M20 (SMA 20) & M7 (SMA 7)
    if (tfData.latestSMA20) {
      const m20 = tfData.latestSMA20.value;
      if (tfData.latestSMA20.isGreen) {
        const signedPct = ((livePrice - m20) / m20) * 100;
        const { zone, weight } = computeAutourWeight(signedPct, maxOvershoot, 1.8);
        if (weight >= 0.5) {
          bullMacroWalls.push({
            label: `${tf}-M20`,
            timeframe: tf,
            price: m20,
            polarity: 'GREEN',
            kind: 'M20',
            signedApproachPct: signedPct,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      } else {
        const signedPct = ((m20 - livePrice) / m20) * 100;
        const { zone, weight } = computeAutourWeight(signedPct, maxOvershoot, 1.8);
        if (weight >= 0.5) {
          bearMacroWalls.push({
            label: `${tf}-M20`,
            timeframe: tf,
            price: m20,
            polarity: 'RED',
            kind: 'M20',
            signedApproachPct: signedPct,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      }
    }

    if (tfData.latestSMA7) {
      const m7 = tfData.latestSMA7.value;
      if (tfData.latestSMA7.isGreen) {
        const signedPct = ((livePrice - m7) / m7) * 100;
        const { zone, weight } = computeAutourWeight(signedPct, maxOvershoot, 1.5);
        if (weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-M7`,
            timeframe: tf,
            price: m7,
            polarity: 'GREEN',
            kind: 'M7',
            signedApproachPct: signedPct,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      } else {
        const signedPct = ((m7 - livePrice) / m7) * 100;
        const { zone, weight } = computeAutourWeight(signedPct, maxOvershoot, 1.5);
        if (weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-M7`,
            timeframe: tf,
            price: m7,
            polarity: 'RED',
            kind: 'M7',
            signedApproachPct: signedPct,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      }
    }

    // 3. HTF Bollinger Lower / Upper Band
    if (tfData.latestBB) {
      const bbLo = tfData.latestBB.lower;
      const bbUp = tfData.latestBB.upper;
      if (bbLo > 0) {
        const signedBull = ((livePrice - bbLo) / bbLo) * 100;
        const { zone, weight } = computeAutourWeight(
          signedBull,
          maxOvershoot,
          1.6
        );
        if (weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-BBInf`,
            timeframe: tf,
            price: bbLo,
            polarity: 'GREEN',
            kind: 'BB',
            signedApproachPct: signedBull,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      }
      if (bbUp > 0) {
        const signedBear = ((bbUp - livePrice) / bbUp) * 100;
        const { zone, weight } = computeAutourWeight(
          signedBear,
          maxOvershoot,
          1.6
        );
        if (weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-BBSup`,
            timeframe: tf,
            price: bbUp,
            polarity: 'RED',
            kind: 'BB',
            signedApproachPct: signedBear,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      }
    }

    // 4. HTF Wilder SAR AT.S
    if (tfData.latestSAR) {
      const sarVal = tfData.latestSAR.value;
      if (tfData.latestSAR.isBullish) {
        const signedBull = ((livePrice - sarVal) / sarVal) * 100;
        const { zone, weight } = computeAutourWeight(
          signedBull,
          maxOvershoot,
          1.5
        );
        if (weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-SAR`,
            timeframe: tf,
            price: sarVal,
            polarity: 'GREEN',
            kind: 'SAR',
            signedApproachPct: signedBull,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      } else {
        const signedBear = ((sarVal - livePrice) / sarVal) * 100;
        const { zone, weight } = computeAutourWeight(
          signedBear,
          maxOvershoot,
          1.5
        );
        if (weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-SAR`,
            timeframe: tf,
            price: sarVal,
            polarity: 'RED',
            kind: 'SAR',
            signedApproachPct: signedBear,
            autourZone: zone,
            autourWeight: weight,
          });
        }
      }
    }
  }

  // Sort Macro Wall candidates by (Timeframe Weight * Autour Weight)
  const rankWall = (w: MacroWallCandidate) =>
    TIMEFRAME_WEIGHTS[w.timeframe] * 14 * w.autourWeight;

  bullMacroWalls.sort((a, b) => rankWall(b) - rankWall(a));
  bearMacroWalls.sort((a, b) => rankWall(b) - rankWall(a));

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

  // Active Wall = at least one HTF Macro element in core "Autour" zone (weight >= 0.68, i.e., ~[-1.2%, +1.5%])
  const activeBullWalls = bullMacroWalls.filter((w) => w.autourWeight >= 0.68);
  const activeBearWalls = bearMacroWalls.filter((w) => w.autourWeight >= 0.68);

  const isAtSupportWall = activeBullWalls.length > 0;
  const isAtResistanceWall = activeBearWalls.length > 0;
  const isAtWall = isAtSupportWall || isAtResistanceWall;

  let direction: SetupDirection = 'NEUTRAL';
  if (isAtSupportWall && isAtResistanceWall) {
    const bullSum = activeBullWalls.reduce((s, w) => s + rankWall(w), 0);
    const bearSum = activeBearWalls.reduce((s, w) => s + rankWall(w), 0);
    direction = bullSum >= bearSum ? 'LONG' : 'SHORT';
  } else if (isAtSupportWall) {
    direction = 'LONG';
  } else if (isAtResistanceWall) {
    direction = 'SHORT';
  }

  const activeMacroCluster =
    direction === 'SHORT' ? activeBearWalls : activeBullWalls;
  const primaryMacro =
    activeMacroCluster.length > 0 ? activeMacroCluster[0] : null;

  const confluentWallLines = activeBullWalls
    .map((w) => w.baselineRef)
    .filter((b): b is ATSBaseline => Boolean(b));
  const confluentResistanceLines = activeBearWalls
    .map((w) => w.baselineRef)
    .filter((b): b is ATSBaseline => Boolean(b));

  const nearestAnyLine = (() => {
    if (nearestGreenSupport && nearestRedResistance) {
      const dSup = Math.abs(livePrice - nearestGreenSupport.price);
      const dRes = Math.abs(nearestRedResistance.price - livePrice);
      return dSup <= dRes ? nearestGreenSupport : nearestRedResistance;
    }
    return nearestGreenSupport ?? nearestRedResistance;
  })();

  const activeWallLabel = primaryMacro
    ? activeMacroCluster.length > 1
      ? `${primaryMacro.label} (+${activeMacroCluster.length - 1})`
      : primaryMacro.label
    : nearestAnyLine
    ? `${nearestAnyLine.label} (${(
        (Math.abs(livePrice - nearestAnyLine.price) / livePrice) *
        100
      ).toFixed(1)}%)`
    : 'Hors Zone Macro';

  const wallPrice = primaryMacro
    ? primaryMacro.price
    : nearestAnyLine?.price ?? null;

  const wallProximityPct =
    wallPrice !== null
      ? (Math.abs(livePrice - wallPrice) / livePrice) * 100
      : null;

  const isShortBias =
    direction === 'SHORT' ||
    (direction === 'NEUTRAL' && nearestAnyLine?.polarity === 'RED');

  // Étape 3 Stop-Loss: Placed strictly below the lowest low of the Étape 1 Support cluster (or above highest Resistance)
  const dBars = timeframes.D.bars;
  const latestDailyLow =
    dBars.length > 0 ? dBars[dBars.length - 1].low : livePrice;
  const latestDailyHigh =
    dBars.length > 0 ? dBars[dBars.length - 1].high : livePrice;

  let stopLoss: number;
  if (!isShortBias) {
    const clusterFloor =
      activeBullWalls.length > 0
        ? Math.min(...activeBullWalls.map((w) => w.price), latestDailyLow)
        : Math.min(wallPrice ?? livePrice, latestDailyLow);
    stopLoss = clusterFloor * 0.99;
  } else {
    const clusterCeiling =
      activeBearWalls.length > 0
        ? Math.max(...activeBearWalls.map((w) => w.price), latestDailyHigh)
        : Math.max(wallPrice ?? livePrice, latestDailyHigh);
    stopLoss = clusterCeiling * 1.01;
  }

  const riskAmount = Math.max(
    Math.abs(livePrice - stopLoss),
    livePrice * 0.005
  );
  const riskPct = (Math.abs(livePrice - stopLoss) / livePrice) * 100;

  // Étape 2 & 4 Targets: TP1 = M7 / Didi (1ère bille noire), TP2 = M20 (2ème bille noire)
  const effectiveTargetTP1 = isShortBias ? downsideDidi : Didi;
  const step2Didi = Boolean(
    effectiveTargetTP1 && effectiveTargetTP1.upsidePct > 0.15
  );

  // Étape 3: Retournement de la BB opposée (Phase 3) + reconquête Oggy court terme
  const curvingTfs = (['D', 'W', 'M'] as const).filter((tf) => {
    const bb = timeframes[tf].bollingerBands;
    if (bb.length < 2) return false;
    const curr = bb[bb.length - 1];
    const prev = bb[bb.length - 2];
    return !isShortBias ? curr.upper < prev.upper : curr.lower > prev.lower;
  });

  const step3VolatilityReversal = curvingTfs.length > 0;
  const reclaimedShortTermOggy = !isShortBias
    ? Boolean(timeframes.D.latestSMA7?.isGreen)
    : Boolean(timeframes.D.latestSMA7 && !timeframes.D.latestSMA7.isGreen);

  let volatilitySignal = 'Phase 2 (Expansion BB)';
  if (curvingTfs.length > 0) {
    volatilitySignal = `Phase 3 (${curvingTfs.join('+')} BB opposée retournée)`;
  } else if (timeframes.D.bbCompressing) {
    volatilitySignal = 'Compression BB en cours';
  }

  // Signal Orange (Candidat) vs Signal Vert / Rouge (Confirmé) per setup1234.pine
  let signalStatus: SetupConfirmationStatus = 'WATCH';
  if (isAtWall) {
    signalStatus = step3VolatilityReversal ? 'CONFIRMED' : 'CANDIDATE';
  }

  // Étape 4: Objectif Final M20 (2ème bille noire — D-M20 si marge >0.8%, sinon W-M20 / M-M20)
  const m20Candidates: MacroTargetTP2[] = [];
  for (const tf of ['D', ...HIGHER_TIMEFRAMES] as Timeframe[]) {
    const m20 = timeframes[tf].latestSMA20?.value ?? timeframes[tf].latestBB?.mid;
    if (!m20 || m20 <= 0) continue;
    const signedPct = ((m20 - livePrice) / livePrice) * 100;
    if (!isShortBias && signedPct > 0.6) {
      m20Candidates.push({
        price: m20,
        label: `${tf}-M20 (Bille 2)`,
        timeframe: tf,
        upsidePct: signedPct,
      });
    } else if (isShortBias && signedPct < -0.6) {
      m20Candidates.push({
        price: m20,
        label: `${tf}-M20 (Bille 2)`,
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

  const targetForRR =
    macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.6
      ? Math.abs(macroTargetTP2.price - livePrice)
      : effectiveTargetTP1
      ? Math.abs(effectiveTargetTP1.price - livePrice)
      : 0;

  const riskRewardRatio =
    targetForRR > 0 && riskAmount > 0 ? targetForRR / riskAmount : null;

  const step4MacroM20 = Boolean(
    macroTargetTP2 &&
      Math.abs(macroTargetTP2.upsidePct) > 0.6 &&
      (riskRewardRatio === null || riskRewardRatio >= 1.1)
  );

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

  // Elastic "Autour" Quantitative Confidence Score (0 - 100%)
  let rawScore = 0;
  if (isAtWall && primaryMacro) {
    // 1. Primary Macro Wall Timeframe + Elastic "Autour" Quality (up to 44 pts)
    const maxTfWeight = Math.max(
      ...activeMacroCluster.map((w) => TIMEFRAME_WEIGHTS[w.timeframe])
    );
    const tfBase = 18 + ((maxTfWeight - 1.15) / 1.45) * 18; // 18..36
    const autourQualityBonus = primaryMacro.autourWeight * 10; // 6.8..10
    rawScore += tfBase + autourQualityBonus;

    // 2. Multi-Indicator / Multi-HTF Cluster "Autour" Bonus (up to 24 pts)
    let clusterBonus = 0;
    for (let i = 1; i < activeMacroCluster.length; i++) {
      const w = activeMacroCluster[i];
      clusterBonus += 4.5 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight;
    }
    const distinctKinds = new Set(activeMacroCluster.map((w) => w.kind));
    if (distinctKinds.size >= 2) clusterBonus += 4;
    rawScore += Math.min(24, clusterBonus);
  } else {
    // Soft outer "Autour" halo (1.5% - 3.5% away) so approaching setups still rank smoothly
    const bestOuter =
      bullMacroWalls[0]?.autourWeight >= (bearMacroWalls[0]?.autourWeight ?? 0)
        ? bullMacroWalls[0]
        : bearMacroWalls[0];
    if (bestOuter && bestOuter.autourWeight > 0) {
      rawScore += Math.round(bestOuter.autourWeight * 24);
    } else if (nearestAnyLine && wallProximityPct !== null && wallProximityPct <= 5) {
      rawScore += Math.max(4, Math.round((1 - wallProximityPct / 5) * 16));
    }
  }

  // 3. Étape 3 Volatility Turn (Signal Confirmé) + Oggy Reclaim + SAR (up to 18 pts)
  if (step3VolatilityReversal) {
    rawScore += curvingTfs.length >= 2 ? 11 : 8;
  } else if (timeframes.D.bbCompressing) {
    rawScore += 4;
  }
  if (reclaimedShortTermOggy) rawScore += 4;

  const sarAligned = !isShortBias
    ? timeframes.D.sarFlippedBullishRecently ||
      timeframes.W.sarFlippedBullishRecently
      ? 4
      : timeframes.D.latestSAR?.isBullish
      ? 2
      : 0
    : timeframes.D.sarFlippedBearishRecently ||
      timeframes.W.sarFlippedBearishRecently
    ? 4
    : timeframes.D.latestSAR && !timeframes.D.latestSAR.isBullish
    ? 2
    : 0;
  rawScore += sarAligned;

  // 4. Étape 2 & 4 Targets (M7 / Dee-Dee & M20 R:R) (up to 14 pts)
  if (step2Didi) rawScore += 4;
  if (step4MacroM20 && riskRewardRatio !== null) {
    if (riskRewardRatio >= 2.5) rawScore += 10;
    else if (riskRewardRatio >= 1.5) rawScore += 7;
    else rawScore += 4;
  }

  const confidenceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Quantitative Reasoning in Clear AT.S Terminology
  const signalTag =
    signalStatus === 'CONFIRMED'
      ? direction === 'SHORT'
        ? 'SIGNAL ROUGE CONFIRMÉ'
        : 'SIGNAL VERT CONFIRMÉ'
      : signalStatus === 'CANDIDATE'
      ? 'SIGNAL ORANGE (Candidat)'
      : 'SURVEILLANCE';

  let thesisHeadline = '';
  const reasoningBullets: string[] = [];

  if (primaryMacro && isAtWall) {
    const zoneDesc =
      primaryMacro.autourZone === 'OVERSHOOT_AUTOUR'
        ? `en zone "Autour" (${primaryMacro.signedApproachPct.toFixed(
            2
          )}% d'excès toléré)`
        : `à ${Math.abs(primaryMacro.signedApproachPct).toFixed(
            2
          )}% ("Autour" du niveau)`;

    const clusterList = activeMacroCluster
      .slice(0, 4)
      .map((w) => `${w.label} (${fmtNum(w.price, category)})`)
      .join(' + ');

    thesisHeadline = `${signalTag} — ${
      direction === 'SHORT' ? 'Rejet Résistance Macro' : 'Rebond Support Macro'
    } sur ${clusterList} ${zoneDesc}`;

    reasoningBullets.push(
      `Étape 1 (Macro "${primaryMacro.autourZone}") : Prix (${fmtNum(
        livePrice,
        category
      )}) testant ${clusterList} sans cassure franche.`
    );
  } else {
    thesisHeadline = nearestAnyLine
      ? `Surveillance : à ${(wallProximityPct ?? 0).toFixed(
          2
        )}% du niveau non-transpercé le plus proche (${nearestAnyLine.label})`
      : 'Aucun niveau Oggy/Jack non-transpercé à proximité immédiate';
  }

  if (effectiveTargetTP1) {
    reasoningBullets.push(
      `Étape 2 (Dee-Dee / Bille 1 M7) : Seuil court terme à ${
        effectiveTargetTP1.label
      } (${fmtNum(effectiveTargetTP1.price, category)}, ${
        isShortBias ? '-' : '+'
      }${effectiveTargetTP1.upsidePct.toFixed(2)}%).`
    );
  }

  reasoningBullets.push(
    `Étape 3 (Volatilité & Invalidation) : ${volatilitySignal} | Oggy 1D ${
      reclaimedShortTermOggy ? 'reconquis ✓' : 'en attente'
    } | Stop-Loss strict sous Étape 1 @ ${fmtNum(
      stopLoss,
      category
    )} (-${riskPct.toFixed(2)}%).`
  );

  if (macroTargetTP2) {
    reasoningBullets.push(
      `Étape 4 (Cible Finale M20 / Bille 2) : ${
        macroTargetTP2.label
      } @ ${fmtNum(macroTargetTP2.price, category)} (${
        macroTargetTP2.upsidePct >= 0 ? '+' : ''
      }${macroTargetTP2.upsidePct.toFixed(2)}%)${
        riskRewardRatio !== null
          ? ` — Ratio R:R ${riskRewardRatio.toFixed(2)}x`
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
    signalStatus,
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
