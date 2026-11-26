import {
  AUTOUR_OVERSHOOT_TOL_PCT,
  calculateTypicalBollingerBands,
  computeAutourWeight,
  flattenTimeframeBaselines,
} from './atsIndicators.ts';
import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  ATSBaseline,
  BollingerBandPoint,
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
      if (l.autourWeight >= 0.65 || absDist <= 1.6) {
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
 * Evaluates the full 4-Step Sequential AT.S Protocol + "Autour" Elastic Scoring
 * aligned with `setup1234.pine`:
 * - Étape 1: Support / Résistance Macro HTF (Oggy/Jack non-transpercés, M20, M7, SAR Wilder, BB Inf/Sup Clôture & Prix Typique hlc3)
 *   - Supports both live proximity (J0) and active bounces within `confirmed_max_age = 8` daily bars
 *     that have NOT invalidated their Stop-Loss and have NOT yet finalized TP2 on D-M20.
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

  const dBars = timeframes.D.bars;
  const dSma20Arr = timeframes.D.sma20;
  const dM20 = timeframes.D.latestSMA20?.value ?? null;
  const dBB = timeframes.D.latestBB;
  const wBB = timeframes.W.latestBB;

  // Volatility-adaptive "Autour" scale ONLY for hyper-volatile assets (D BB bandwidth > 40%, e.g. NBIS at 83%)
  const volatilityScale = dBB
    ? Math.min(1.5, Math.max(1.0, dBB.bandwidth / 0.4))
    : 1.0;

  const dailyConsistent =
    dBars.length >= 2 &&
    Math.abs(dBars[dBars.length - 1].close - livePrice) <=
      Math.max(0.01, livePrice * 0.03);

  // Build active 0..8 daily trigger probes matching `confirmed_max_age = 8` in setup1234.pine
  const bullProbes: ActiveTriggerProbe[] = [
    {
      age: 0,
      low: dailyConsistent ? Math.min(dBars[dBars.length - 1].low, livePrice) : livePrice,
      high: dailyConsistent ? Math.max(dBars[dBars.length - 1].high, livePrice) : livePrice,
      close: livePrice,
    },
  ];
  const bearProbes: ActiveTriggerProbe[] = [
    {
      age: 0,
      low: dailyConsistent ? Math.min(dBars[dBars.length - 1].low, livePrice) : livePrice,
      high: dailyConsistent ? Math.max(dBars[dBars.length - 1].high, livePrice) : livePrice,
      close: livePrice,
    },
  ];

  if (dailyConsistent && dBars.length >= 5) {
    const sma20Offset = dBars.length - dSma20Arr.length;
    const maxLookback = Math.min(8, dBars.length - 2);

    for (let lb = 1; lb <= maxLookback; lb++) {
      const idx = dBars.length - 1 - lb;
      const bar = dBars[idx];

      // Active LONG bounce check (setup1234.pine lines 414-427):
      // Must still be below D-M20 (TP2 not closed above) and no subsequent close < triggerLow * 0.99
      if (dM20 !== null && livePrice < dM20 * 0.999) {
        let validBull = true;
        const invalidFloor = bar.low * 0.99;
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

      // Active SHORT rejection check (setup1234.pine lines 458-471):
      // Must still be above D-M20 (TP2 not closed below), triggered near upper BB, and no close > triggerHigh * 1.01
      const nearUpperEnvelope =
        (dBB && bar.high >= dBB.upper * 0.985) ||
        (wBB && bar.high >= wBB.upper * 0.99);
      if (dM20 !== null && livePrice > dM20 * 1.001 && nearUpperEnvelope) {
        let validBear = true;
        const invalidCeil = bar.high * 1.01;
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

  // Evaluate best "Autour" touch across live price and active unfinalized bounce probes
  const evaluateBestBullTouch = (
    levelPrice: number,
    maxOvershootPct: number,
    baseMaxApproachPct = 2.2
  ) => {
    const effOvershoot = maxOvershootPct * volatilityScale;
    const maxApproachPct = baseMaxApproachPct * volatilityScale;
    if (levelPrice <= 0 || livePrice < levelPrice * (1 - effOvershoot / 100)) {
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
      effOvershoot,
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
        effOvershoot * 1.2,
        maxApproachPct
      );
      const ageFactor = Math.max(0.9, 1 - probe.age * 0.012);
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

  // In AT.S / setup1234.pine (line 469), a SHORT setup only exists while price is ABOVE D-M20 (targeting D-M20 below)
  const allowShortSetup =
    !dailyConsistent || dM20 === null || livePrice >= dM20 * 0.995;

  const evaluateBestBearTouch = (
    levelPrice: number,
    maxOvershootPct: number,
    maxApproachPct = 2.0
  ) => {
    if (
      !allowShortSetup ||
      levelPrice <= 0 ||
      livePrice > levelPrice * (1 + maxOvershootPct / 100)
    ) {
      return {
        zone: 'DISTANT' as const,
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
        maxOvershootPct * 1.2,
        maxApproachPct
      );
      const ageFactor = Math.max(0.9, 1 - probe.age * 0.012);
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

  // Precompute hlc3 Bollinger Bands (Prix Typique) per HTF matching setup1234.pine lines 169 & 244
  const hlc3BBByTf = {} as Record<Timeframe, BollingerBandPoint | null>;
  for (const tf of HIGHER_TIMEFRAMES) {
    const typ = calculateTypicalBollingerBands(timeframes[tf].bars, 20, 2);
    hlc3BBByTf[tf] = typ.length > 0 ? typ[typ.length - 1] : null;
  }

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
        const touch = evaluateBestBullTouch(line.price, maxOvershoot, 2.2);
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
        const touch = evaluateBestBearTouch(line.price, maxOvershoot, 2.0);
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

    // 2. Dynamic HTF M20 (SMA 20 Clôture) & M7 (SMA 7 Clôture)
    if (tfData.latestSMA20) {
      const m20 = tfData.latestSMA20.value;
      if (tfData.latestSMA20.isGreen) {
        const touch = evaluateBestBullTouch(m20, maxOvershoot, 1.9);
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
        const touch = evaluateBestBearTouch(m20, maxOvershoot, 1.8);
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
        const touch = evaluateBestBullTouch(m7, maxOvershoot, 1.7);
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
        const touch = evaluateBestBearTouch(m7, maxOvershoot, 1.6);
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

    // 3. HTF Bollinger Lower / Upper Band (evaluating both Clôture and Prix Typique hlc3)
    // Crucial AT.S rule (setup1234.pine line 348): BBSup is ONLY a Bear resistance when falling (!upperGreen)!
    const hlcBB = hlc3BBByTf[tf];
    if (tfData.latestBB) {
      const bbLoClose = tfData.latestBB.lower;
      const bbLoHlc = hlcBB?.lower ?? 0;

      // Dynamic BBInf support: rising BBInf, or 1W/1M oversold envelope with opposite BB turning / D oversold
      const allowBullBB =
        tfData.latestBB.lowerGreen ||
        hlcBB?.lowerGreen ||
        ((tf === 'W' || tf === 'M') &&
          livePrice > Math.min(bbLoClose, bbLoHlc > 0 ? bbLoHlc : bbLoClose) &&
          (dBB ? bullProbes[0].low <= dBB.lower * 1.02 || !dBB.upperGreen : true));

      if (allowBullBB) {
        const closeTouch =
          bbLoClose > 0
            ? evaluateBestBullTouch(bbLoClose, maxOvershoot * 1.25, 2.4)
            : null;
        const hlcTouch =
          bbLoHlc > 0
            ? evaluateBestBullTouch(bbLoHlc, maxOvershoot * 1.25, 2.4)
            : null;

        const bestBBTouch =
          hlcTouch && (!closeTouch || hlcTouch.weight > closeTouch.weight)
            ? { ...hlcTouch, price: bbLoHlc }
            : closeTouch
            ? { ...closeTouch, price: bbLoClose }
            : null;

        if (bestBBTouch && bestBBTouch.weight >= 0.55) {
          bullMacroWalls.push({
            label: `${tf}-BBInf`,
            timeframe: tf,
            price: bestBBTouch.price,
            polarity: 'GREEN',
            kind: 'BB',
            signedApproachPct: bestBBTouch.signedPct,
            autourZone: bestBBTouch.zone,
            autourWeight: bestBBTouch.weight,
            triggerAgeBars: bestBBTouch.age,
            triggerExtremePrice: bestBBTouch.extremePrice,
          });
        }
      }

      // Bearish BBSup: strictly requires falling upper band (!upperGreen) per setup1234.pine line 348
      const closeBearTouch =
        !tfData.latestBB.upperGreen && tfData.latestBB.upper > 0
          ? evaluateBestBearTouch(tfData.latestBB.upper, maxOvershoot, 1.8)
          : null;
      const hlcBearTouch =
        hlcBB && !hlcBB.upperGreen && hlcBB.upper > 0
          ? evaluateBestBearTouch(hlcBB.upper, maxOvershoot, 1.8)
          : null;

      const bestBearBB =
        hlcBearTouch &&
        (!closeBearTouch || hlcBearTouch.weight > closeBearTouch.weight)
          ? { ...hlcBearTouch, price: hlcBB!.upper }
          : closeBearTouch
          ? { ...closeBearTouch, price: tfData.latestBB.upper }
          : null;

      if (bestBearBB && bestBearBB.weight >= 0.55) {
        bearMacroWalls.push({
          label: `${tf}-BBSup`,
          timeframe: tf,
          price: bestBearBB.price,
          polarity: 'RED',
          kind: 'BB',
          signedApproachPct: bestBearBB.signedPct,
          autourZone: bestBearBB.zone,
          autourWeight: bestBearBB.weight,
          triggerAgeBars: bestBearBB.age,
          triggerExtremePrice: bestBearBB.extremePrice,
        });
      }
    }

    // 4. HTF Wilder SAR AT.S
    if (tfData.latestSAR) {
      const sarVal = tfData.latestSAR.value;
      if (tfData.latestSAR.isBullish) {
        const touch = evaluateBestBullTouch(sarVal, maxOvershoot, 2.0);
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
        const touch = evaluateBestBearTouch(sarVal, maxOvershoot, 1.8);
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

  // Active Wall = at least one HTF Macro element in core "Autour" zone (weight >= 0.65)
  const activeBullWalls = bullMacroWalls.filter((w) => w.autourWeight >= 0.65);
  const activeBearWalls = bearMacroWalls.filter((w) => w.autourWeight >= 0.65);

  const isAtSupportWall = activeBullWalls.length > 0;
  const isAtResistanceWall = activeBearWalls.length > 0;
  const isAtWall = isAtSupportWall || isAtResistanceWall;

  let direction: SetupDirection = 'NEUTRAL';
  if (isAtSupportWall && isAtResistanceWall) {
    let bullSum = activeBullWalls.reduce((s, w) => s + rankWall(w), 0);
    let bearSum = activeBearWalls.reduce((s, w) => s + rankWall(w), 0);
    // Add Daily polarity & SAR tie-breaker (e.g. DXY holding D-Oggy + D-SAR vs WMT/PG hitting D-BBUp)
    if (timeframes.D.latestSAR?.isBullish) bullSum += 6;
    if (dBB && bullProbes[0].high >= dBB.upper * 0.99) bearSum += 10;
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

  // Étape 3 Stop-Loss: Strictly 0.5% below the Étape 1 trigger low / primary macro floor (setup1234.pine line 414)
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

  // Étape 2 & 4 Targets: TP1 = M7 / Didi (1ère bille noire), TP2 = M20 (2ème bille noire)
  const effectiveTargetTP1 = isShortBias ? downsideDidi : Didi;
  const maxTriggerAge = primaryMacro ? primaryMacro.triggerAgeBars : 0;

  // If price already reclaimed D-M7 during an active bounce toward D-M20, TP1 (Étape 2) is already validated!
  const tp1AlreadyReclaimed =
    !isShortBias &&
    maxTriggerAge > 0 &&
    timeframes.D.latestSMA7 !== null &&
    livePrice >= timeframes.D.latestSMA7.value;

  const step2Didi = Boolean(
    tp1AlreadyReclaimed ||
      (effectiveTargetTP1 && effectiveTargetTP1.upsidePct > 0.15)
  );

  // Étape 3: Retournement de la BB opposée (sur la bougie courante ou depuis le déclenchement comme setup1234.pine line 433)
  const curvingTfs = (['D', 'W', 'M'] as const).filter((tf) => {
    const bb = timeframes[tf].bollingerBands;
    if (bb.length < 2) return false;
    const maxLb = tf === 'D' ? Math.min(maxTriggerAge + 1, 4) : 1;
    for (let lb = 0; lb <= maxLb; lb++) {
      const idx = bb.length - 1 - lb;
      if (idx >= 1) {
        if (!isShortBias && bb[idx].upper < bb[idx - 1].upper) return true;
        if (isShortBias && bb[idx].lower > bb[idx - 1].lower) return true;
      }
    }
    return false;
  });

  const step3VolatilityReversal = curvingTfs.length > 0;
  const reclaimedShortTermOggy = !isShortBias
    ? Boolean(timeframes.D.latestSMA7?.isGreen || tp1AlreadyReclaimed)
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

  // Étape 4: Objectif Final M20 (2ème bille noire — D-M20 si marge >0.6%, sinon W-M20 / M-M20 / BB opposée)
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
  } else if (!isShortBias && timeframes.W.latestBB && timeframes.W.latestBB.upper > livePrice * 1.004) {
    const wUp = timeframes.W.latestBB.upper;
    macroTargetTP2 = {
      price: wUp,
      label: 'W-BBSup',
      timeframe: 'W',
      upsidePct: ((wUp - livePrice) / livePrice) * 100,
    };
  } else if (timeframes.W.latestSMA20) {
    const wM20 = timeframes.W.latestSMA20.value;
    macroTargetTP2 = {
      price: wM20,
      label: 'W-M20',
      timeframe: 'W',
      upsidePct: ((wM20 - livePrice) / livePrice) * 100,
    };
  }

  // Evaluate R:R both from current livePrice AND from the Étape 1 trigger price
  const triggerEntryRef = primaryMacro
    ? !isShortBias
      ? Math.max(primaryMacro.price, primaryMacro.triggerExtremePrice)
      : Math.min(primaryMacro.price, primaryMacro.triggerExtremePrice)
    : livePrice;

  const targetPriceVal =
    macroTargetTP2 && Math.abs(macroTargetTP2.upsidePct) > 0.35
      ? macroTargetTP2.price
      : effectiveTargetTP1
      ? effectiveTargetTP1.price
      : livePrice;

  const liveReward = Math.abs(targetPriceVal - livePrice);
  const setupReward = Math.abs(targetPriceVal - triggerEntryRef);
  const setupRisk = Math.max(
    Math.abs(triggerEntryRef - stopLoss),
    livePrice * 0.005
  );

  const riskRewardRatio =
    liveReward > 0 && riskAmount > 0
      ? Math.max(liveReward / riskAmount, (setupReward / setupRisk) * 0.85)
      : null;

  const step4MacroM20 = Boolean(
    macroTargetTP2 &&
      Math.abs(macroTargetTP2.upsidePct) > 0.35 &&
      (riskRewardRatio === null || riskRewardRatio >= 1.0)
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
    // 1. Primary Macro Wall Timeframe + Elastic "Autour" Precision (44..60 pts)
    const maxTfWeight = Math.max(
      ...activeMacroCluster.map((w) => TIMEFRAME_WEIGHTS[w.timeframe])
    );
    const tfBase = 35 + ((maxTfWeight - 1.15) / 1.45) * 13; // 35 (1W) .. 48 (12M)
    const autourQualityBonus = primaryMacro.autourWeight * 12; // 7.8 .. 12
    rawScore += tfBase + autourQualityBonus;

    // 2. Multi-Indicator / Multi-HTF Cluster Confluence Bonus (up to 16 pts)
    let clusterBonus = 0;
    for (let i = 1; i < activeMacroCluster.length; i++) {
      const w = activeMacroCluster[i];
      clusterBonus += 3.8 * TIMEFRAME_WEIGHTS[w.timeframe] * w.autourWeight;
    }
    const distinctKinds = new Set(activeMacroCluster.map((w) => w.kind));
    if (distinctKinds.size >= 2) clusterBonus += 3;
    rawScore += Math.min(16, clusterBonus);

    // 3. Étape 3 Volatility Turn (Signal Confirmé) + Oggy Reclaim + SAR (up to 14 pts)
    if (step3VolatilityReversal) {
      rawScore += curvingTfs.length >= 2 ? 10 : 8;
    } else if (timeframes.D.bbCompressing) {
      rawScore += 4;
    }
    if (reclaimedShortTermOggy) rawScore += 3;

    const sarAligned = !isShortBias
      ? timeframes.D.sarFlippedBullishRecently ||
        timeframes.W.sarFlippedBullishRecently ||
        timeframes.D.latestSAR?.isBullish
        ? 3
        : 0
      : timeframes.D.sarFlippedBearishRecently ||
        timeframes.W.sarFlippedBearishRecently ||
        (timeframes.D.latestSAR && !timeframes.D.latestSAR.isBullish)
      ? 3
      : 0;
    rawScore += sarAligned;

    // 4. Daily Bollinger Envelope Excess Bonus (setup1234.pine lines 374 & 376)
    const minProbeLow = Math.min(...bullProbes.map((p) => p.low));
    const maxProbeHigh = Math.max(...bearProbes.map((p) => p.high));
    const hasDailyBBExcess = Boolean(
      dBB &&
        (!isShortBias
          ? minProbeLow <= dBB.lower + dBB.stdDev * 0.2
          : maxProbeHigh >= dBB.upper - dBB.stdDev * 0.2)
    );
    if (hasDailyBBExcess) rawScore += 6;

    // 5. Étape 2 & 4 Targets + Full 4-Step Protocol Completion (up to 14 pts)
    if (step2Didi) rawScore += 3;
    if (step4MacroM20 && riskRewardRatio !== null) {
      if (riskRewardRatio >= 2.0) rawScore += 7;
      else if (riskRewardRatio >= 1.2) rawScore += 5;
      else rawScore += 3;
    }
    if (setupStep === 4) rawScore += 4;
  } else {
    // Off-wall / Surveillance ("WATCH"): capped well below active AT.S setups (< 45%)
    const bestOuter =
      (bullMacroWalls[0]?.autourWeight ?? 0) >=
      (bearMacroWalls[0]?.autourWeight ?? 0)
        ? bullMacroWalls[0]
        : bearMacroWalls[0];
    if (bestOuter && bestOuter.autourWeight > 0) {
      rawScore += Math.round(bestOuter.autourWeight * 34);
    } else if (
      nearestAnyLine &&
      wallProximityPct !== null &&
      wallProximityPct <= 5
    ) {
      rawScore += Math.max(5, Math.round((1 - wallProximityPct / 5) * 20));
    }
    if (step3VolatilityReversal) rawScore += 5;
    if (step2Didi) rawScore += 3;
    rawScore = Math.min(44, rawScore);
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
    const ageNote =
      primaryMacro.triggerAgeBars > 0
        ? ` [testé à J-${primaryMacro.triggerAgeBars} @ ${fmtNum(
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
      )}) validé sur ${clusterList}${ageNote} sans invalidation.`
    );
  } else {
    thesisHeadline = nearestAnyLine
      ? `Surveillance : à ${(wallProximityPct ?? 0).toFixed(
          2
        )}% du niveau non-transpercé le plus proche (${nearestAnyLine.label})`
      : 'Aucun niveau Oggy/Jack non-transpercé à proximité immédiate';
  }

  if (tp1AlreadyReclaimed && timeframes.D.latestSMA7) {
    reasoningBullets.push(
      `Étape 2 (Dee-Dee / Bille 1 M7) : D-M7 (${fmtNum(
        timeframes.D.latestSMA7.value,
        category
      )}) déjà reconquise ✓ — en route vers Bille 2 (M20).`
    );
  } else if (effectiveTargetTP1) {
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
      reclaimedShortTermOggy ? 'reconquis ✓' : 'en attente'
    } | Stop-Loss strict sous Étape 1 @ ${fmtNum(stopLoss, category)} (${
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
