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
  W: 15,
  M: 20,
  '3M': 24,
  '6M': 27,
  '12M': 30,
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
 * Pure Setup 1-2-3-4 Realization Probability Scorer (0 - 100%):
 *
 * Confidence Score measures ONLY the structural probability that the 1-2-3-4 setup
 * holds its macro wall and realizes (ZERO points from targets or risk-to-reward):
 *   1. Macro Wall Authority (0..38 pts):
 *      - Timeframe Hierarchy (Weekly=15, Monthly=20, Quarterly=24, Semi-Annual=27, Annual=30) * autourWeight
 *      - Clean Touch Precision (up to +8 pts when testing right around the unbroken level).
 *   2. Multi-Timeframe & Multi-Indicator Confluence (0..32 pts):
 *      - 0 pts if testing a single isolated line.
 *      - Stacked unbroken higher-timeframe levels (up to +22 pts) + Cross-Timeframe (+5) & Cross-Indicator (+5) synergy.
 *   3. Volatility Exhaustion & Price Reaction at the Wall (0..20 pts):
 *      - Arrival Exhaustion at outer Daily Bollinger Band (up to +6 pts).
 *      - Volatility Deceleration / Phase Transition (up to +8 pts).
 *      - Candle Rejection / Defense at the level (up to +6 pts).
 *   4. Higher-Timeframe Trend Backing (0..10 pts):
 *      - Macro trend alignment across Weekly..Annual moving averages & Wilder Parabolic Stop and Reverse.
 *   5. Opposing Barrier Friction (0..-15 pts):
 *      - Deducted if an unbroken opposing higher-timeframe wall sits immediately in the way.
 *
 * Sequential Lifecycle State (`setupStep` 0..4):
 *   - Most active screener candidates naturally sit at Step 1 (arriving at macro wall)
 *     or Step 2 (holding wall + short-term Dee-Dee threshold traced, awaiting breakout).
 *   - Step 3 requires BOTH opposite daily Bollinger Band turning inward AND price reclaiming daily Oggy + M7.
 *   - Step 4 requires Step 3 triggered on a prior bar AND intermediate M7 target already reached on the way to M20.
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

  const dOppositeCurvingBull =
    dBBArr.length >= 2 &&
    dBBArr[dBBArr.length - 1].upper < dBBArr[dBBArr.length - 2].upper;
  const dOppositeCurvingBear =
    dBBArr.length >= 2 &&
    dBBArr[dBBArr.length - 1].lower > dBBArr[dBBArr.length - 2].lower;

  // Check if opposite daily Bollinger Band expansion is decelerating / flattening (< 0.12% bar-over-bar)
  const dOppositeFlatteningBull =
    dBBArr.length >= 2 &&
    !dOppositeCurvingBull &&
    dBBArr[dBBArr.length - 2].upper > 0 &&
    (dBBArr[dBBArr.length - 1].upper - dBBArr[dBBArr.length - 2].upper) /
      dBBArr[dBBArr.length - 2].upper <=
      0.0012;
  const dOppositeFlatteningBear =
    dBBArr.length >= 2 &&
    !dOppositeCurvingBear &&
    dBBArr[dBBArr.length - 2].lower > 0 &&
    (dBBArr[dBBArr.length - 2].lower - dBBArr[dBBArr.length - 1].lower) /
      dBBArr[dBBArr.length - 2].lower <=
      0.0012;

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

  // Strict setup1234.pine recent bounce probes (age = 1..4 ONLY when that bar pierced outside 1D BB,
  // Stop-Loss held, and D-M20 has not yet been closed across)
  if (dailyConsistent && dBars.length >= 6 && dBBArr.length >= 6) {
    const sma20Offset = dBars.length - dSma20Arr.length;
    const bbOffset = dBars.length - dBBArr.length;
    const maxLookback = Math.min(4, dBars.length - 2);

    for (let lb = 1; lb <= maxLookback; lb++) {
      const idx = dBars.length - 1 - lb;
      const bar = dBars[idx];
      const bbIdx = idx - bbOffset;
      const bbAtBar =
        bbIdx >= 0 && bbIdx < dBBArr.length ? dBBArr[bbIdx] : dBB;

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

  // Symmetric evaluation for Bullish Support vs Bearish Resistance
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
      const ageFactor =
        probe.age === 0 ? 0.96 : Math.max(0.65, 0.92 - probe.age * 0.065);
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
      const ageFactor =
        probe.age === 0 ? 0.96 : Math.max(0.65, 0.92 - probe.age * 0.065);
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

    // 1. Unpierced Oggy & Jack baselines
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

    // 2. Dynamic HTF M20 & M7
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

    // 3. HTF Bollinger Bands — strict slope filter (`lowerGreen` for support, `!upperGreen` for resistance)
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

    // 4. HTF Wilder SAR AT.S
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

  // Reference Trade Management Values (displayed in UI table ONLY — NOT used in Confidence Score!)
  const latestDailyBar = dBars.length > 0 ? dBars[dBars.length - 1] : null;
  const latestDailyLow = latestDailyBar ? latestDailyBar.low : livePrice;
  const latestDailyHigh = latestDailyBar ? latestDailyBar.high : livePrice;

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

  // =========================================================================
  // SEQUENTIAL SETUP 1-2-3-4 STAGE DETECTION (Usually Step 1 or Step 2!)
  // =========================================================================
  const curvingTfs = (['D', 'W', 'M'] as const).filter((tf) => {
    const bb = timeframes[tf].bollingerBands;
    if (bb.length < 2) return false;
    const curr = bb[bb.length - 1];
    const prev = bb[bb.length - 2];
    return !isShortBias ? curr.upper < prev.upper : curr.lower > prev.lower;
  });

  const dOppositeTurned = curvingTfs.includes('D');
  const dVolatilityStabilizing =
    dOppositeTurned ||
    timeframes.D.bbCompressing ||
    (!isShortBias ? dOppositeFlatteningBull : dOppositeFlatteningBear);

  // Candle defense / rejection check at the wall
  const candleDefense = (() => {
    if (!latestDailyBar) return false;
    const range = latestDailyBar.high - latestDailyBar.low;
    if (!isShortBias) {
      return (
        latestDailyBar.close > latestDailyBar.open ||
        (range > 0 &&
          (latestDailyBar.close - latestDailyBar.low) / range >= 0.55)
      );
    }
    return (
      latestDailyBar.close < latestDailyBar.open ||
      (range > 0 &&
        (latestDailyBar.high - latestDailyBar.close) / range >= 0.55)
    );
  })();

  // Short-term Oggy_0 + M7 breakout confirmation (true Step 3 trigger!)
  const dOggy0 = timeframes.D.Oggy.Oggy_0;
  const reclaimedDailyOggyAndM7 = !isShortBias
    ? Boolean(
        timeframes.D.latestSMA7?.isGreen &&
          (!dOggy0 || livePrice > dOggy0.price)
      )
    : Boolean(
        timeframes.D.latestSMA7 &&
          !timeframes.D.latestSMA7.isGreen &&
          (!dOggy0 || livePrice < dOggy0.price)
      );

  // Step 2: Wall is holding as daily volatility begins decelerating/turning & Dee-Dee control level is traced
  const hasDeeDeeControl = Boolean(effectiveTargetTP1);
  const step2HoldingAndDeeDee =
    isAtWall && hasDeeDeeControl && dVolatilityStabilizing;

  // Step 3: BOTH opposite daily Bollinger Band turned inward AND short-term Oggy/M7 trigger reclaimed
  const step3Triggered =
    isAtWall && dOppositeTurned && reclaimedDailyOggyAndM7;

  // Step 4: Triggered on a prior bar AND already cleared intermediate D-M7 on the way toward D-M20
  const step4AdvancingToM20 = Boolean(
    step3Triggered &&
      primaryMacro &&
      primaryMacro.triggerAgeBars >= 1 &&
      timeframes.D.latestSMA7 &&
      (!isShortBias
        ? livePrice >= timeframes.D.latestSMA7.value
        : livePrice <= timeframes.D.latestSMA7.value)
  );

  let setupStep: 0 | 1 | 2 | 3 | 4 = 0;
  if (isAtWall) {
    setupStep = 1;
    if (step2HoldingAndDeeDee) {
      setupStep = 2;
    }
    if (step3Triggered) {
      setupStep = 3;
      if (step4AdvancingToM20) {
        setupStep = 4;
      }
    }
  }

  let volatilitySignal = 'Étape 1 (Arrivée sur mur macro — BB en expansion)';
  if (step3Triggered) {
    volatilitySignal = `Étape 3 Déclenchée (${curvingTfs.join('+')} BB retournée + Oggy/M7)`;
  } else if (dOppositeTurned) {
    volatilitySignal = `Étape 2 (${curvingTfs.join('+')} BB retournée — attente cassure Dee-Dee)`;
  } else if (dVolatilityStabilizing) {
    volatilitySignal = 'Étape 2 (Stabilisation BB — tracé Dee-Dee)';
  }

  // =========================================================================
  // PURE SETUP 1-2-3-4 REALIZATION PROBABILITY SCORE (0 - 100%)
  // (Strictly 0% weight on Risk/Reward or Profit Targets)
  // =========================================================================
  let rawScore = 0;

  if (isAtWall && primaryMacro) {
    // 1. Macro Wall Authority — Timeframe Hierarchy + "Autour" Precision (max 38 pts)
    const maxTfPoints = Math.max(
      ...activeMacroCluster.map((w) => TIMEFRAME_BASE_POINTS[w.timeframe])
    );
    const absApproach = Math.abs(primaryMacro.signedApproachPct);
    const touchPrecisionBonus =
      absApproach <= 0.5 && primaryMacro.triggerAgeBars === 0
        ? 8
        : absApproach <= 1.0 && primaryMacro.triggerAgeBars <= 1
        ? 5
        : absApproach <= 1.5
        ? 2
        : 0;
    rawScore += maxTfPoints * primaryMacro.autourWeight + touchPrecisionBonus;

    // 2. Multi-Timeframe & Multi-Indicator Confluence Density (max 32 pts; 0 pts for 1 isolated line!)
    let clusterBonus = 0;
    const seenPrices: number[] = [primaryMacro.price];
    for (let i = 1; i < activeMacroCluster.length; i++) {
      const w = activeMacroCluster[i];
      const isDuplicatePrice = seenPrices.some(
        (p) => Math.abs(p - w.price) / p < 0.0015
      );
      seenPrices.push(w.price);
      const dupDiscount = isDuplicatePrice ? 0.5 : 1.0;
      clusterBonus +=
        4.2 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight * dupDiscount;
    }
    const distinctTfs = new Set(activeMacroCluster.map((w) => w.timeframe));
    const distinctKinds = new Set(activeMacroCluster.map((w) => w.kind));
    if (distinctTfs.size >= 2) clusterBonus += 5;
    if (distinctKinds.size >= 2) clusterBonus += 5;
    rawScore += Math.min(32, clusterBonus);

    // 3. Volatility Exhaustion & Price Reaction at the Wall (max 20 pts)
    let exhaustionAndReaction = 0;
    // 3a. Outer Daily Bollinger Band stretch / exhaustion arrival (0..6 pts)
    if (dBB && dBB.stdDev > 0) {
      const probeExtreme = !isShortBias
        ? Math.min(...bullProbes.map((p) => p.low))
        : Math.max(...bearProbes.map((p) => p.high));
      const atOuterBand = !isShortBias
        ? probeExtreme <= dBB.lower + dBB.stdDev * 0.25
        : probeExtreme >= dBB.upper - dBB.stdDev * 0.25;
      const stretchedFromMid = !isShortBias
        ? probeExtreme <= dBB.mid - dBB.stdDev * 1.3
        : probeExtreme >= dBB.mid + dBB.stdDev * 1.3;
      if (atOuterBand) exhaustionAndReaction += 6;
      else if (stretchedFromMid) exhaustionAndReaction += 3;
    }

    // 3b. Volatility Deceleration / Opposite Band Turn (0..8 pts)
    if (dOppositeTurned) {
      exhaustionAndReaction += curvingTfs.length >= 2 ? 8 : 7;
    } else if (dVolatilityStabilizing) {
      exhaustionAndReaction += 5;
    } else if (curvingTfs.length > 0) {
      // Weekly or Monthly opposite band already turning while Daily finishes testing
      exhaustionAndReaction += 3;
    }

    // 3c. Candle Defense & Short-Term Polarity / SAR Reaction (0..6 pts)
    if (candleDefense) exhaustionAndReaction += 3;
    const sarOrOggyReaction = !isShortBias
      ? timeframes.D.sarFlippedBullishRecently ||
        timeframes.W.sarFlippedBullishRecently ||
        reclaimedDailyOggyAndM7 ||
        timeframes.D.latestSAR?.isBullish
      : timeframes.D.sarFlippedBearishRecently ||
        timeframes.W.sarFlippedBearishRecently ||
        reclaimedDailyOggyAndM7 ||
        Boolean(timeframes.D.latestSAR && !timeframes.D.latestSAR.isBullish);
    if (sarOrOggyReaction) exhaustionAndReaction += 3;

    rawScore += Math.min(20, exhaustionAndReaction);

    // 4. Higher-Timeframe Macro Trend Backing (max 10 pts)
    let macroTrendPts = 0;
    for (const htf of HIGHER_TIMEFRAMES) {
      const m20Aligned = !isShortBias
        ? Boolean(timeframes[htf].latestSMA20?.isGreen)
        : Boolean(
            timeframes[htf].latestSMA20 && !timeframes[htf].latestSMA20.isGreen
          );
      const sarAligned = !isShortBias
        ? Boolean(timeframes[htf].latestSAR?.isBullish)
        : Boolean(
            timeframes[htf].latestSAR && !timeframes[htf].latestSAR.isBullish
          );
      if (m20Aligned && sarAligned) macroTrendPts += 2;
      else if (m20Aligned || sarAligned) macroTrendPts += 1;
    }
    rawScore += Math.min(10, macroTrendPts);

    // 5. Opposing Unbroken Higher-Timeframe Barrier Friction (0..-15 pts)
    if (opposingMacroCluster.length > 0) {
      const oppPenalty = opposingMacroCluster.reduce(
        (s, w) => s + 3.0 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight,
        0
      );
      rawScore -= Math.min(15, oppPenalty);
    }
  } else {
    // Off-wall ("WATCH" / Neutral): 0..38% max
    const bestOuter =
      (bullMacroWalls[0]?.autourWeight ?? 0) >=
      (bearMacroWalls[0]?.autourWeight ?? 0)
        ? bullMacroWalls[0]
        : bearMacroWalls[0];
    if (bestOuter && bestOuter.autourWeight > 0) {
      rawScore += Math.round(bestOuter.autourWeight * 28);
    } else if (
      nearestAnyLine &&
      wallProximityPct !== null &&
      wallProximityPct <= 4
    ) {
      rawScore += Math.max(4, Math.round((1 - wallProximityPct / 4) * 16));
    }
    rawScore = Math.min(38, rawScore);
  }

  // Full 0 - 100% probability scale (no 98% cap and no Step 1/2 cap!)
  const confidenceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Weak single-line grazes (< 55%) remain Neutral / Watch
  if (confidenceScore < 55) {
    direction = 'NEUTRAL';
    setupStep = 0;
  }

  const effectiveAtWall = isAtWall && direction !== 'NEUTRAL';
  const effectiveSupportWall = isAtSupportWall && direction === 'LONG';
  const effectiveResistanceWall = isAtResistanceWall && direction === 'SHORT';

  let signalStatus: SetupConfirmationStatus = 'WATCH';
  if (effectiveAtWall) {
    signalStatus = setupStep >= 3 || dOppositeTurned ? 'CONFIRMED' : 'CANDIDATE';
  }

  const signalTag =
    signalStatus === 'CONFIRMED'
      ? direction === 'SHORT'
        ? 'SIGNAL ROUGE CONFIRMÉ'
        : 'SIGNAL VERT CONFIRMÉ'
      : signalStatus === 'CANDIDATE'
      ? 'SIGNAL ORANGE (En formation Étape 1-2)'
      : 'SURVEILLANCE';

  let thesisHeadline = '';
  const reasoningBullets: string[] = [];

  if (primaryMacro && effectiveAtWall) {
    const ageNote =
      primaryMacro.triggerAgeBars > 0
        ? ` [test J-${primaryMacro.triggerAgeBars} @ ${fmtNum(
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

    thesisHeadline = `${signalTag} [Étape ${setupStep}/4] — ${
      direction === 'SHORT' ? 'Résistance Macro' : 'Support Macro'
    } sur ${clusterList} ${zoneDesc}`;

    reasoningBullets.push(
      `Étape 1 (Mur Macro "${primaryMacro.autourZone}") : Cours (${fmtNum(
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
      `Étape 2 (Tracé Dee-Dee) : Seuil de contrôle court terme à ${
        effectiveTargetTP1.label
      } (${fmtNum(effectiveTargetTP1.price, category)}, ${
        isShortBias ? '-' : '+'
      }${effectiveTargetTP1.upsidePct.toFixed(2)}%).`
    );
  }

  reasoningBullets.push(
    `Étape 3 (Volatilité & Déclenchement) : ${volatilitySignal} | Stop-Loss invalidation @ ${fmtNum(
      stopLoss,
      category
    )} (${isShortBias ? '+' : '-'}${riskPct.toFixed(2)}%).`
  );

  if (macroTargetTP2) {
    reasoningBullets.push(
      `Étape 4 (Référence Objectif M20 — hors score) : ${
        macroTargetTP2.label
      } @ ${fmtNum(macroTargetTP2.price, category)} (${
        macroTargetTP2.upsidePct >= 0 ? '+' : ''
      }${macroTargetTP2.upsidePct.toFixed(2)}%).`
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
      step1Wall: effectiveAtWall && setupStep >= 1,
      step2Didi: effectiveAtWall && setupStep >= 2,
      step3VolatilityReversal: effectiveAtWall && setupStep >= 3,
      step4MacroM20: effectiveAtWall && setupStep >= 4,
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
