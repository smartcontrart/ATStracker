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

const TIMEFRAME_BASE_POINTS: Record<Timeframe, number> = {
  D: 10,
  W: 16,
  M: 20,
  '3M': 23,
  '6M': 25,
  '12M': 28,
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
  triggerAgeBars: number;
  triggerExtremePrice: number;
  baselineRef?: ATSBaseline;
}

interface ActiveTriggerProbe {
  age: number;
  low: number;
  high: number;
  close: number;
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
      if (l.autourWeight >= 0.72 || absDist <= 1.2) {
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
 * Symmetric, selective AT.S 4-Step Screener & Confidence Score (0 - 100%):
 *
 * Score Breakdown (100 pts max):
 *   A. Primary HTF Wall Strength & "Autour" Precision (0..34 pts):
 *      - Timeframe Base (1W=16, 1M=20, 3M=23, 6M=25, 12M=28) * autourWeight + exact-touch bonus (0..6).
 *      - Single isolated 1W touch starts around ~16-22 pts (never inflated to 70%+ alone).
 *   B. Multi-Timeframe & Multi-Indicator Confluence (0..26 pts):
 *      - Rewards 2..5+ independent unpierced HTF levels clustering "Autour" of price across multiple TFs/families.
 *   C. Étape 3 — Live Volatility Reversal & Momentum (0..22 pts):
 *      - Opposite Bollinger Band curving inward ON THE CURRENT BAR (D/W/M): +10..14 pts (0 pts if still expanding).
 *      - Wilder SAR aligned/flipped (+2..4 pts) + 1D M7/Oggy reclaimed (+4 pts).
 *   D. Étape 2 & 4 — Live Risk/Reward to M20 Target (0..18 pts, or -8 penalty if R:R < 1.0x):
 *      - Clear Dee-Dee / M7 threshold (+4 pts) + Live R:R to M20 (+6..14 pts).
 *   E. Opposing HTF Headwind Penalty (0..-12 pts):
 *      - Deducted if an unpierced opposite-polarity HTF wall sits right in the way.
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

  const dBars = timeframes.D.bars;
  const dSma20Arr = timeframes.D.sma20;
  const dBBArr = timeframes.D.bollingerBands;
  const dM20 = timeframes.D.latestSMA20?.value ?? null;
  const dBB = timeframes.D.latestBB;

  const dailyConsistent =
    dBars.length >= 2 &&
    Math.abs(dBars[dBars.length - 1].close - livePrice) <=
      Math.max(0.01, livePrice * 0.03);

  // Current-bar (live) opposite Bollinger Band turn check — strict, never looking back 5 days
  const dOppositeCurvingBull =
    dBBArr.length >= 2 &&
    dBBArr[dBBArr.length - 1].upper < dBBArr[dBBArr.length - 2].upper;
  const dOppositeCurvingBear =
    dBBArr.length >= 2 &&
    dBBArr[dBBArr.length - 1].lower > dBBArr[dBBArr.length - 2].lower;

  // Live probe (age = 0)
  const bullProbes: ActiveTriggerProbe[] = [
    {
      age: 0,
      low: dailyConsistent
        ? Math.min(dBars[dBars.length - 1].low, livePrice)
        : livePrice,
      high: dailyConsistent
        ? Math.max(dBars[dBars.length - 1].high, livePrice)
        : livePrice,
      close: livePrice,
    },
  ];
  const bearProbes: ActiveTriggerProbe[] = [
    {
      age: 0,
      low: dailyConsistent
        ? Math.min(dBars[dBars.length - 1].low, livePrice)
        : livePrice,
      high: dailyConsistent
        ? Math.max(dBars[dBars.length - 1].high, livePrice)
        : livePrice,
      close: livePrice,
    },
  ];

  // Strict setup1234.pine multi-bar bounce probes (age = 1..5 ONLY when that bar pierced outside 1D BB,
  // opposite 1D BB is curving inward TODAY, Stop-Loss held, and D-M20 TP2 has NOT been reached yet)
  if (dailyConsistent && dBars.length >= 6 && dBBArr.length >= 6) {
    const sma20Offset = dBars.length - dSma20Arr.length;
    const bbOffset = dBars.length - dBBArr.length;
    const maxLookback = Math.min(5, dBars.length - 2);

    for (let lb = 1; lb <= maxLookback; lb++) {
      const idx = dBars.length - 1 - lb;
      const bar = dBars[idx];
      const bbIdx = idx - bbOffset;
      const bbAtBar =
        bbIdx >= 0 && bbIdx < dBBArr.length ? dBBArr[bbIdx] : dBB;

      // Strict Bullish setup1234.pine bounce: bar pierced <= D-BBLow, D-BBUp turning down TODAY, live < D-M20
      if (
        dM20 !== null &&
        livePrice < dM20 * 0.992 &&
        dOppositeCurvingBull &&
        bbAtBar &&
        bar.low <= bbAtBar.lower * 1.002
      ) {
        let validBull = true;
        const invalidFloor = bar.low * 0.995;
        for (let k = idx + 1; k < dBars.length; k++) {
          const s20Idx = k - sma20Offset;
          const s20AtK =
            s20Idx >= 0 && s20Idx < dSma20Arr.length
              ? dSma20Arr[s20Idx].value
              : dM20;
          if (dBars[k].close < invalidFloor || dBars[k].close >= s20AtK) {
            validBull = false;
            break;
          }
        }
        if (validBull) {
          bullProbes.push({
            age: lb,
            low: bar.low,
            high: bar.high,
            close: bar.close,
          });
        }
      }

      // Symmetric Strict Bearish setup1234.pine rejection: bar pierced >= D-BBUp, D-BBLow turning up TODAY, live > D-M20
      if (
        dM20 !== null &&
        livePrice > dM20 * 1.008 &&
        dOppositeCurvingBear &&
        bbAtBar &&
        bar.high >= bbAtBar.upper * 0.998
      ) {
        let validBear = true;
        const invalidCeil = bar.high * 1.005;
        for (let k = idx + 1; k < dBars.length; k++) {
          const s20Idx = k - sma20Offset;
          const s20AtK =
            s20Idx >= 0 && s20Idx < dSma20Arr.length
              ? dSma20Arr[s20Idx].value
              : dM20;
          if (dBars[k].close > invalidCeil || dBars[k].close <= s20AtK) {
            validBear = false;
            break;
          }
        }
        if (validBear) {
          bearProbes.push({
            age: lb,
            low: bar.low,
            high: bar.high,
            close: bar.close,
          });
        }
      }
    }
  }

  // Symmetric evaluation for Bullish Support vs Bearish Resistance (NO directional bias!)
  const evaluateBestBullTouch = (
    levelPrice: number,
    maxOvershootPct: number,
    maxApproachPct = 1.6
  ) => {
    if (levelPrice <= 0 || livePrice < levelPrice * (1 - maxOvershootPct / 100)) {
      return {
        zone: 'PIERCED' as const,
        weight: 0,
        signedPct: ((livePrice - levelPrice) / levelPrice) * 100,
        age: 0,
        extremePrice: livePrice,
      };
    }

    const liveSigned = ((livePrice - levelPrice) / levelPrice) * 100;
    const liveEval = computeAutourWeight(
      liveSigned,
      maxOvershootPct,
      maxApproachPct
    );
    let bestZone = liveEval.zone;
    let bestWeight = liveEval.weight;
    let bestSigned = liveSigned;
    let bestAge = 0;
    let bestExtreme = bullProbes[0].low;

    for (const probe of bullProbes) {
      const wickSigned = ((probe.low - levelPrice) / levelPrice) * 100;
      const wickEval = computeAutourWeight(
        wickSigned,
        maxOvershootPct,
        maxApproachPct
      );
      // Meaningful decay with age so older bounces score lower than live touches
      const ageFactor = probe.age === 0 ? 0.96 : Math.max(0.62, 0.92 - probe.age * 0.065);
      const adjustedWeight = wickEval.weight * ageFactor;
      if (adjustedWeight > bestWeight) {
        bestWeight = adjustedWeight;
        bestZone = wickEval.zone;
        bestSigned = wickSigned;
        bestAge = probe.age;
        bestExtreme = probe.low;
      }
    }

    return {
      zone: bestZone,
      weight: bestWeight,
      signedPct: bestSigned,
      age: bestAge,
      extremePrice: bestExtreme,
    };
  };

  const evaluateBestBearTouch = (
    levelPrice: number,
    maxOvershootPct: number,
    maxApproachPct = 1.6
  ) => {
    if (levelPrice <= 0 || livePrice > levelPrice * (1 + maxOvershootPct / 100)) {
      return {
        zone: 'PIERCED' as const,
        weight: 0,
        signedPct: ((levelPrice - livePrice) / levelPrice) * 100,
        age: 0,
        extremePrice: livePrice,
      };
    }

    const liveSigned = ((levelPrice - livePrice) / levelPrice) * 100;
    const liveEval = computeAutourWeight(
      liveSigned,
      maxOvershootPct,
      maxApproachPct
    );
    let bestZone = liveEval.zone;
    let bestWeight = liveEval.weight;
    let bestSigned = liveSigned;
    let bestAge = 0;
    let bestExtreme = bearProbes[0].high;

    for (const probe of bearProbes) {
      const wickSigned = ((levelPrice - probe.high) / levelPrice) * 100;
      const wickEval = computeAutourWeight(
        wickSigned,
        maxOvershootPct,
        maxApproachPct
      );
      const ageFactor = probe.age === 0 ? 0.96 : Math.max(0.62, 0.92 - probe.age * 0.065);
      const adjustedWeight = wickEval.weight * ageFactor;
      if (adjustedWeight > bestWeight) {
        bestWeight = adjustedWeight;
        bestZone = wickEval.zone;
        bestSigned = wickSigned;
        bestAge = probe.age;
        bestExtreme = probe.high;
      }
    }

    return {
      zone: bestZone,
      weight: bestWeight,
      signedPct: bestSigned,
      age: bestAge,
      extremePrice: bestExtreme,
    };
  };

  // Collect UNPIERCED Macro Supports & Resistances across Higher Timeframes (1W, 1M, 3M, 6M, 12M)
  const htfGreenBaselines: ATSBaseline[] = [];
  const htfRedBaselines: ATSBaseline[] = [];
  const bullMacroWalls: MacroWallCandidate[] = [];
  const bearMacroWalls: MacroWallCandidate[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const maxOvershoot = AUTOUR_OVERSHOOT_TOL_PCT[tf];

    // 1. Unpierced Oggy & Jack baselines (completely symmetric GREEN vs RED)
    const unpierced = flattenTimeframeBaselines(tfData.Jack, tfData.Oggy, true);
    for (const line of unpierced) {
      if (line.polarity === 'GREEN') {
        htfGreenBaselines.push(line);
        const touch = evaluateBestBullTouch(line.price, maxOvershoot, 1.6);
        if (touch.weight >= 0.45) {
          bullMacroWalls.push({
            label: line.label,
            timeframe: tf,
            price: line.price,
            polarity: 'GREEN',
            kind: line.family,
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
            baselineRef: line,
          });
        }
      } else {
        htfRedBaselines.push(line);
        const touch = evaluateBestBearTouch(line.price, maxOvershoot, 1.6);
        if (touch.weight >= 0.45) {
          bearMacroWalls.push({
            label: line.label,
            timeframe: tf,
            price: line.price,
            polarity: 'RED',
            kind: line.family,
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
            baselineRef: line,
          });
        }
      }
    }

    // 2. Dynamic HTF M20 (SMA 20) & M7 (SMA 7) — symmetric rising vs falling
    if (tfData.latestSMA20) {
      const m20 = tfData.latestSMA20.value;
      if (tfData.latestSMA20.isGreen) {
        const touch = evaluateBestBullTouch(m20, maxOvershoot, 1.5);
        if (touch.weight >= 0.5) {
          bullMacroWalls.push({
            label: `${tf}-M20`,
            timeframe: tf,
            price: m20,
            polarity: 'GREEN',
            kind: 'M20',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      } else {
        const touch = evaluateBestBearTouch(m20, maxOvershoot, 1.5);
        if (touch.weight >= 0.5) {
          bearMacroWalls.push({
            label: `${tf}-M20`,
            timeframe: tf,
            price: m20,
            polarity: 'RED',
            kind: 'M20',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      }
    }

    if (tfData.latestSMA7) {
      const m7 = tfData.latestSMA7.value;
      if (tfData.latestSMA7.isGreen) {
        const touch = evaluateBestBullTouch(m7, maxOvershoot, 1.4);
        if (touch.weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-M7`,
            timeframe: tf,
            price: m7,
            polarity: 'GREEN',
            kind: 'M7',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      } else {
        const touch = evaluateBestBearTouch(m7, maxOvershoot, 1.4);
        if (touch.weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-M7`,
            timeframe: tf,
            price: m7,
            polarity: 'RED',
            kind: 'M7',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      }
    }

    // 3. HTF Bollinger Bands — STRICT slope filter (setup1234.pine lines 316 & 348):
    //    - BBInf is ONLY a support when rising/flattening (`lowerGreen === true`)
    //    - BBSup is ONLY a resistance when falling (`upperGreen === false`)
    if (tfData.latestBB) {
      if (tfData.latestBB.lowerGreen && tfData.latestBB.lower > 0) {
        const touch = evaluateBestBullTouch(
          tfData.latestBB.lower,
          maxOvershoot,
          1.4
        );
        if (touch.weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-BBInf`,
            timeframe: tf,
            price: tfData.latestBB.lower,
            polarity: 'GREEN',
            kind: 'BB',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      }

      if (!tfData.latestBB.upperGreen && tfData.latestBB.upper > 0) {
        const touch = evaluateBestBearTouch(
          tfData.latestBB.upper,
          maxOvershoot,
          1.4
        );
        if (touch.weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-BBSup`,
            timeframe: tf,
            price: tfData.latestBB.upper,
            polarity: 'RED',
            kind: 'BB',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      }
    }

    // 4. HTF Wilder SAR AT.S — symmetric bullish vs bearish
    if (tfData.latestSAR) {
      const sarVal = tfData.latestSAR.value;
      if (tfData.latestSAR.isBullish) {
        const touch = evaluateBestBullTouch(sarVal, maxOvershoot, 1.4);
        if (touch.weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-SAR`,
            timeframe: tf,
            price: sarVal,
            polarity: 'GREEN',
            kind: 'SAR',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
          });
        }
      } else {
        const touch = evaluateBestBearTouch(sarVal, maxOvershoot, 1.4);
        if (touch.weight >= 0.55) {
          bearMacroWalls.push({
            label: `${tf}-SAR`,
            timeframe: tf,
            price: sarVal,
            polarity: 'RED',
            kind: 'SAR',
            signedApproachPct: touch.signedPct,
            autourZone: touch.zone,
            autourWeight: touch.weight,
            triggerAgeBars: touch.age,
            triggerExtremePrice: touch.extremePrice,
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

  // Strict Active Wall threshold: weight >= 0.70 (live within ~[-1.1%, +1.2%], or fresh BB-excess bounce)
  const activeBullWalls = bullMacroWalls.filter((w) => w.autourWeight >= 0.7);
  const activeBearWalls = bearMacroWalls.filter((w) => w.autourWeight >= 0.7);

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
  const opposingMacroCluster =
    direction === 'SHORT' ? activeBullWalls : activeBearWalls;
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

  // Étape 3 Stop-Loss: Strictly 0.5% beyond the Étape 1 floor / ceiling
  const latestDailyLow =
    dBars.length > 0 ? dBars[dBars.length - 1].low : livePrice;
  const latestDailyHigh =
    dBars.length > 0 ? dBars[dBars.length - 1].high : livePrice;

  let stopLoss: number;
  if (!isShortBias) {
    const refFloor = primaryMacro
      ? Math.min(primaryMacro.price, primaryMacro.triggerExtremePrice)
      : Math.min(wallPrice ?? livePrice, latestDailyLow);
    stopLoss = refFloor * 0.995;
  } else {
    const refCeiling = primaryMacro
      ? Math.max(primaryMacro.price, primaryMacro.triggerExtremePrice)
      : Math.max(wallPrice ?? livePrice, latestDailyHigh);
    stopLoss = refCeiling * 1.005;
  }

  const riskAmount = Math.max(
    Math.abs(livePrice - stopLoss),
    livePrice * 0.005
  );
  const riskPct = (Math.abs(livePrice - stopLoss) / livePrice) * 100;

  // Étape 2 Targets: TP1 = M7 / Didi (1ère bille noire)
  const effectiveTargetTP1 = isShortBias ? downsideDidi : Didi;
  const step2Didi = Boolean(
    effectiveTargetTP1 && effectiveTargetTP1.upsidePct > 0.25
  );

  // Étape 3: STRICT LIVE opposite Bollinger Band turn — MUST turn on 1D trigger timeframe (setup1234.pine line 433)
  const curvingTfs = (['D', 'W', 'M'] as const).filter((tf) => {
    const bb = timeframes[tf].bollingerBands;
    if (bb.length < 2) return false;
    const curr = bb[bb.length - 1];
    const prev = bb[bb.length - 2];
    return !isShortBias ? curr.upper < prev.upper : curr.lower > prev.lower;
  });

  // Confirmation strictly requires 1D opposite Bollinger Band turning inward (Phase 3 on 1D)
  const step3VolatilityReversal = curvingTfs.includes('D');
  const reclaimedShortTermOggy = !isShortBias
    ? Boolean(timeframes.D.latestSMA7?.isGreen)
    : Boolean(timeframes.D.latestSMA7 && !timeframes.D.latestSMA7.isGreen);

  let volatilitySignal = 'Phase 2 (Expansion BB — Non confirmé)';
  if (curvingTfs.length > 0) {
    volatilitySignal = `Phase 3 (${curvingTfs.join('+')} BB opposée retournée)`;
  } else if (timeframes.D.bbCompressing) {
    volatilitySignal = 'Compression BB en cours';
  }

  // Signal Orange (Candidat) vs Signal Vert / Rouge (Confirmé)
  let signalStatus: SetupConfirmationStatus = 'WATCH';
  if (isAtWall) {
    signalStatus = step3VolatilityReversal ? 'CONFIRMED' : 'CANDIDATE';
  }

  // Étape 4: Objectif Final M20 (2ème bille noire) & LIVE Risk/Reward Ratio
  const m20Candidates: MacroTargetTP2[] = [];
  for (const tf of ['D', ...HIGHER_TIMEFRAMES] as Timeframe[]) {
    const m20 =
      timeframes[tf].latestSMA20?.value ?? timeframes[tf].latestBB?.mid;
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

  // Honest LIVE Risk/Reward (measured strictly from current livePrice, never historical entry!)
  const liveReward =
    macroTargetTP2 &&
    ((!isShortBias && macroTargetTP2.upsidePct > 0.4) ||
      (isShortBias && macroTargetTP2.upsidePct < -0.4))
      ? Math.abs(macroTargetTP2.price - livePrice)
      : effectiveTargetTP1
      ? Math.abs(effectiveTargetTP1.price - livePrice)
      : 0;

  const riskRewardRatio =
    liveReward > 0 && riskAmount > 0 ? liveReward / riskAmount : null;

  const step4MacroM20 = Boolean(
    macroTargetTP2 &&
      ((!isShortBias && macroTargetTP2.upsidePct > 0.6) ||
        (isShortBias && macroTargetTP2.upsidePct < -0.6)) &&
      riskRewardRatio !== null &&
      riskRewardRatio >= 1.2
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

  // =========================================================================
  // HONEST, SELECTIVE QUANTITATIVE CONFIDENCE SCORE (0 - 100%)
  // =========================================================================
  let rawScore = 0;

  if (isAtWall && primaryMacro) {
    // A. Primary HTF Wall Strength & "Autour" Precision (max 34 pts)
    const maxTfPoints = Math.max(
      ...activeMacroCluster.map((w) => TIMEFRAME_BASE_POINTS[w.timeframe])
    );
    const exactTouchBonus =
      Math.abs(primaryMacro.signedApproachPct) <= 0.5 &&
      primaryMacro.triggerAgeBars === 0
        ? 6
        : Math.abs(primaryMacro.signedApproachPct) <= 1.0 &&
          primaryMacro.triggerAgeBars <= 1
        ? 3
        : 0;
    rawScore += maxTfPoints * primaryMacro.autourWeight + exactTouchBonus;

    // B. Multi-Timeframe & Multi-Indicator Confluence (max 26 pts; 0 pts if only 1 isolated line!)
    let clusterBonus = 0;
    // Deduplicate identical price levels (e.g. M-Jack_0 == 3M-Oggy_0) so same close isn't double-counted full weight
    const seenPrices: number[] = [primaryMacro.price];
    for (let i = 1; i < activeMacroCluster.length; i++) {
      const w = activeMacroCluster[i];
      const isDuplicatePrice = seenPrices.some(
        (p) => Math.abs(p - w.price) / p < 0.0015
      );
      seenPrices.push(w.price);
      const dupDiscount = isDuplicatePrice ? 0.45 : 1.0;
      clusterBonus +=
        3.2 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight * dupDiscount;
    }
    const distinctTfs = new Set(activeMacroCluster.map((w) => w.timeframe));
    const distinctKinds = new Set(activeMacroCluster.map((w) => w.kind));
    if (distinctTfs.size >= 2) clusterBonus += 3;
    if (distinctKinds.size >= 2) clusterBonus += 3;
    rawScore += Math.min(26, clusterBonus);

    // C. Étape 3 — Live Volatility Reversal & Momentum (max 22 pts)
    if (step3VolatilityReversal) {
      rawScore += curvingTfs.length >= 2 ? 14 : 10;
    } else if (timeframes.D.bbCompressing) {
      rawScore += 4;
    }
    if (reclaimedShortTermOggy) rawScore += 4;

    const sarScore = !isShortBias
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
    rawScore += sarScore;

    // D. Étape 2 & 4 — Targets & Live Risk/Reward Ratio (max 18 pts, penalty if R:R < 1.0x)
    if (step2Didi) rawScore += 4;
    if (riskRewardRatio !== null) {
      if (riskRewardRatio >= 3.0) rawScore += 14;
      else if (riskRewardRatio >= 2.0) rawScore += 10;
      else if (riskRewardRatio >= 1.3) rawScore += 6;
      else if (riskRewardRatio < 0.9) rawScore -= 8;
    }

    // E. Opposing HTF Headwind Penalty (up to -12 pts when trapped between Green support & Red resistance)
    if (opposingMacroCluster.length > 0) {
      const oppPenalty = opposingMacroCluster.reduce(
        (s, w) => s + 2.5 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight,
        0
      );
      rawScore -= Math.min(12, oppPenalty);
    }

    // Unconfirmed Phase 2 setups (Signal Orange — opposite BB still expanding) cannot exceed 68%
    if (!step3VolatilityReversal) {
      rawScore = Math.min(68, rawScore);
    }
  } else {
    // Off-wall ("WATCH" / Neutral): 0..38% max
    const bestOuter =
      (bullMacroWalls[0]?.autourWeight ?? 0) >=
      (bearMacroWalls[0]?.autourWeight ?? 0)
        ? bullMacroWalls[0]
        : bearMacroWalls[0];
    if (bestOuter && bestOuter.autourWeight > 0) {
      rawScore += Math.round(bestOuter.autourWeight * 26);
    } else if (
      nearestAnyLine &&
      wallProximityPct !== null &&
      wallProximityPct <= 4
    ) {
      rawScore += Math.max(4, Math.round((1 - wallProximityPct / 4) * 16));
    }
    if (step3VolatilityReversal) rawScore += 4;
    rawScore = Math.min(38, rawScore);
  }

  const confidenceScore = Math.max(0, Math.min(98, Math.round(rawScore)));

  // Selectivity gate: weak single-line brushes (< 55%) remain NEUTRAL / WATCH
  // so 70-80% of a scanned universe stays neutral white rather than flooding green/red.
  if (confidenceScore < 55) {
    direction = 'NEUTRAL';
    signalStatus = 'WATCH';
    setupStep = 0;
  }

  const effectiveAtWall = isAtWall && direction !== 'NEUTRAL';
  const effectiveSupportWall = isAtSupportWall && direction === 'LONG';
  const effectiveResistanceWall = isAtResistanceWall && direction === 'SHORT';

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

  if (primaryMacro && effectiveAtWall) {
    const ageNote =
      primaryMacro.triggerAgeBars > 0
        ? ` [rebond J-${primaryMacro.triggerAgeBars} @ ${fmtNum(
            primaryMacro.triggerExtremePrice,
            category
          )}]`
        : '';

    const zoneDesc =
      primaryMacro.autourZone === 'OVERSHOOT_AUTOUR'
        ? `en zone "Autour" (${primaryMacro.signedApproachPct.toFixed(
            2
          )}% d'excès toléré)${ageNote}`
        : `à ${Math.abs(primaryMacro.signedApproachPct).toFixed(
            2
          )}% ("Autour" du niveau)${ageNote}`;

    const clusterList = activeMacroCluster
      .slice(0, 4)
      .map((w) => `${w.label} (${fmtNum(w.price, category)})`)
      .join(' + ');

    thesisHeadline = `${signalTag} — ${
      direction === 'SHORT' ? 'Rejet Résistance Macro' : 'Rebond Support Macro'
    } sur ${clusterList} ${zoneDesc}`;

    reasoningBullets.push(
      `Étape 1 (Macro "${primaryMacro.autourZone}") : Cours (${fmtNum(
        livePrice,
        category
      )}) sur ${clusterList}${ageNote}.`
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
    `Étape 3 (Volatilité & Invalidation) : ${volatilitySignal} | Oggy/M7 1D ${
      reclaimedShortTermOggy ? 'aligné ✓' : 'en attente'
    } | Stop-Loss strict @ ${fmtNum(stopLoss, category)} (${
      isShortBias ? '+' : '-'
    }${riskPct.toFixed(2)}%).`
  );

  if (macroTargetTP2) {
    reasoningBullets.push(
      `Étape 4 (Cible Finale M20 / Bille 2) : ${
        macroTargetTP2.label
      } @ ${fmtNum(macroTargetTP2.price, category)} (${
        macroTargetTP2.upsidePct >= 0 ? '+' : ''
      }${macroTargetTP2.upsidePct.toFixed(2)}%)${
        riskRewardRatio !== null
          ? ` — Ratio R:R live ${riskRewardRatio.toFixed(2)}x`
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
    isAtWall: effectiveAtWall,
    isAtSupportWall: effectiveSupportWall,
    isAtResistanceWall: effectiveResistanceWall,
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
      step1Wall: effectiveAtWall,
      step2Didi: effectiveAtWall && step2Didi,
      step3VolatilityReversal: effectiveAtWall && step3VolatilityReversal,
      step4MacroM20: effectiveAtWall && step4MacroM20,
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
