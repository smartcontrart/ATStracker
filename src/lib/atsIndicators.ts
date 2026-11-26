import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  ATSBaseline,
  ATSLineKey,
  ATSPolarity,
  BollingerBandPoint,
  DidiTarget,
  JackMatrix,
  MovingAveragePoint,
  OggyMatrix,
  OHLCVBar,
  ParabolicSARPoint,
  Timeframe,
  TimeframeATSData,
  TimeframeSetup1234,
} from '../types/ats.ts';

const CHART_PROXIMITY_PCT_BY_TF: Record<Timeframe, number> = {
  D: 3.5,
  W: 5.0,
  M: 6.5,
  '3M': 8.0,
  '6M': 8.0,
  '12M': 8.0,
};

/**
 * Maximum acceptable "Autour" overshoot % before a level is considered truly
 * pierced ("transpercé — ne fait plus effet").
 * E.g. Support at 100$: dip to 99.5$ or 99.0$ (-0.5% to -1.2%) is valid "Autour";
 * drop to 97$ (-3%) is PIERCED. Matches tol_brk (1.0% - 1.4%) in setup1234.pine.
 */
export const AUTOUR_OVERSHOOT_TOL_PCT: Record<Timeframe, number> = {
  D: 1.0,
  W: 1.2,
  M: 1.3,
  '3M': 1.5,
  '6M': 1.5,
  '12M': 1.6,
};

const TIMEFRAME_ORDER_INDEX: Record<Timeframe, number> = {
  D: 0,
  W: 1,
  M: 2,
  '3M': 3,
  '6M': 4,
  '12M': 5,
};

export function resolveATSPolarity(
  currentPrice: number,
  historicalClose: number
): ATSPolarity {
  return currentPrice >= historicalClose ? 'GREEN' : 'RED';
}

/**
 * Computes continuous AT.S "Autour" quality weight (0..1) for a candidate level.
 * - approachPct > 0 means price is approaching BEFORE touching the level (e.g. 101$ on 100$ support)
 * - approachPct < 0 means price slightly overshot INTO the "Autour" halo (e.g. 99.3$ on 100$ support)
 */
export function computeAutourWeight(
  signedApproachPct: number,
  maxOvershootPct: number,
  maxApproachPct = 2.2
): {
  zone: 'EXACT' | 'APPROACH' | 'OVERSHOOT_AUTOUR' | 'DISTANT' | 'PIERCED';
  weight: number;
} {
  if (signedApproachPct < -maxOvershootPct) {
    return { zone: 'PIERCED', weight: 0 };
  }

  // Slight overshoot into "Autour" zone (e.g. 99.5$ or 99.0$ around 100$ support)
  if (signedApproachPct < 0) {
    const ratio = Math.abs(signedApproachPct) / maxOvershootPct; // 0..1
    const weight = Math.max(0.68, 0.96 - ratio * 0.28);
    return { zone: 'OVERSHOOT_AUTOUR', weight };
  }

  // Exact touch zone (0% to +0.35%)
  if (signedApproachPct <= 0.35) {
    return { zone: 'EXACT', weight: 1.0 };
  }

  // Core AT.S approach zone (+0.35% to +1.2%, e.g. 100.4$ - 101.2$)
  if (signedApproachPct <= 1.2) {
    const ratio = (signedApproachPct - 0.35) / 0.85;
    return { zone: 'APPROACH', weight: 1.0 - ratio * 0.14 }; // 1.0 -> 0.86
  }

  // Outer "Autour" halo (+1.2% to +2.2%)
  if (signedApproachPct <= maxApproachPct) {
    const ratio = (signedApproachPct - 1.2) / (maxApproachPct - 1.2);
    return { zone: 'APPROACH', weight: Math.max(0.25, 0.86 - ratio * 0.61) };
  }

  return { zone: 'DISTANT', weight: 0 };
}

/**
 * Evaluates structural polarity (Support vs Resistance) and STRICT unbroken integrity:
 * - CRITICAL RULE: Do NOT render or use any Jack or Oggy line that has already been
 *   pierced/broken by the live price.
 *   - If a Green support is currently ABOVE livePrice (`levelPrice > currentPrice`), it is BROKEN.
 *   - If a Red resistance is currently BELOW livePrice (`levelPrice < currentPrice`), it is BROKEN.
 *   - If recent closes sliced across the level from one side to the other, it is BROKEN.
 */
function evaluateBaselineIntegrity(
  bars: OHLCVBar[],
  refIdx: number,
  levelPrice: number,
  currentPrice: number,
  timeframe: Timeframe,
  recentDailyBars?: OHLCVBar[]
): {
  polarity: ATSPolarity;
  isPierced: boolean;
  autourZone: ATSBaseline['autourZone'];
  autourWeight: number;
} {
  const lastIdx = bars.length - 1;
  const maxOvershootPct = AUTOUR_OVERSHOOT_TOL_PCT[timeframe];

  const dailyConsistent =
    Boolean(recentDailyBars) &&
    recentDailyBars!.length >= 4 &&
    Math.abs(
      recentDailyBars![recentDailyBars!.length - 1].close - bars[lastIdx].close
    ) <= Math.max(0.01, bars[lastIdx].close * 0.02);

  if (dailyConsistent && recentDailyBars) {
    const afterRef = recentDailyBars.filter(
      (b) => b.time > bars[refIdx].time
    );
    const recent = afterRef.slice(-10);

    if (recent.length >= 2) {
      const priorSlice = recent.slice(
        Math.max(0, recent.length - 6),
        recent.length - 1
      );
      const priorAvgClose =
        priorSlice.reduce((sum, b) => sum + b.close, 0) / priorSlice.length;

      const maxClose = Math.max(...recent.map((b) => b.close));
      const minClose = Math.min(...recent.map((b) => b.close));

      // Sliced straight across level in recent sessions
      const slicedThroughCloses =
        maxClose > levelPrice * 1.002 && minClose < levelPrice * 0.998;

      const structuralSupport =
        priorAvgClose > levelPrice ||
        (priorAvgClose === levelPrice && currentPrice >= levelPrice);

      if (structuralSupport) {
        // Strict rule: if Green support is currently ABOVE livePrice (currentPrice < levelPrice), it is BROKEN!
        const piercedDown =
          currentPrice < levelPrice ||
          slicedThroughCloses ||
          minClose < levelPrice * 0.998;

        if (piercedDown) {
          return {
            polarity: 'GREEN',
            isPierced: true,
            autourZone: 'PIERCED',
            autourWeight: 0,
          };
        }

        const signedApproachPct =
          ((currentPrice - levelPrice) / levelPrice) * 100;
        const { zone, weight } = computeAutourWeight(
          signedApproachPct,
          maxOvershootPct
        );
        return {
          polarity: 'GREEN',
          isPierced: false,
          autourZone: zone,
          autourWeight: weight,
        };
      } else {
        // Strict rule: if Red resistance is currently BELOW livePrice (currentPrice > levelPrice), it is BROKEN!
        const piercedUp =
          currentPrice > levelPrice ||
          slicedThroughCloses ||
          maxClose > levelPrice * 1.002;

        if (piercedUp) {
          return {
            polarity: 'RED',
            isPierced: true,
            autourZone: 'PIERCED',
            autourWeight: 0,
          };
        }

        const signedApproachPct =
          ((levelPrice - currentPrice) / levelPrice) * 100;
        const { zone, weight } = computeAutourWeight(
          signedApproachPct,
          maxOvershootPct
        );
        return {
          polarity: 'RED',
          isPierced: false,
          autourZone: zone,
          autourWeight: weight,
        };
      }
    }
  }

  // Fallback on single-timeframe series
  const recentStart = Math.max(refIdx + 1, lastIdx - 3);
  const priorBars = bars.slice(recentStart, lastIdx);
  const anchor =
    priorBars.length > 0
      ? priorBars.reduce((sum, b) => sum + b.close, 0) / priorBars.length
      : bars[lastIdx].open;

  const structuralSupport =
    anchor > levelPrice || (anchor === levelPrice && currentPrice >= levelPrice);

  if (structuralSupport) {
    let piercedDown = currentPrice < levelPrice;
    if (!piercedDown) {
      for (const b of priorBars) {
        if (b.close < levelPrice) {
          piercedDown = true;
          break;
        }
      }
    }

    if (piercedDown) {
      return {
        polarity: 'GREEN',
        isPierced: true,
        autourZone: 'PIERCED',
        autourWeight: 0,
      };
    }

    const signedApproachPct = ((currentPrice - levelPrice) / levelPrice) * 100;
    const { zone, weight } = computeAutourWeight(
      signedApproachPct,
      maxOvershootPct
    );
    return {
      polarity: 'GREEN',
      isPierced: false,
      autourZone: zone,
      autourWeight: weight,
    };
  } else {
    let piercedUp = currentPrice > levelPrice;
    if (!piercedUp) {
      for (const b of priorBars) {
        if (b.close > levelPrice) {
          piercedUp = true;
          break;
        }
      }
    }

    if (piercedUp) {
      return {
        polarity: 'RED',
        isPierced: true,
        autourZone: 'PIERCED',
        autourWeight: 0,
      };
    }

    const signedApproachPct = ((levelPrice - currentPrice) / levelPrice) * 100;
    const { zone, weight } = computeAutourWeight(
      signedApproachPct,
      maxOvershootPct
    );
    return {
      polarity: 'RED',
      isPierced: false,
      autourZone: zone,
      autourWeight: weight,
    };
  }
}

function buildBaseline(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe,
  key: ATSLineKey,
  family: 'Jack' | 'Oggy',
  offset: number,
  recentDailyBars?: OHLCVBar[]
): ATSBaseline | null {
  const targetIdx = bars.length - 1 - offset;
  if (targetIdx < 0 || targetIdx >= bars.length) {
    return null;
  }

  const refBar = bars[targetIdx];
  const price = refBar.close;
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const distancePct = ((currentPrice - price) / price) * 100;
  const absDistanceFromLivePct =
    (Math.abs(currentPrice - price) / currentPrice) * 100;

  const { polarity, isPierced, autourZone, autourWeight } =
    evaluateBaselineIntegrity(
      bars,
      targetIdx,
      price,
      currentPrice,
      timeframe,
      recentDailyBars
    );

  const shouldPlotOnChart =
    !isPierced && absDistanceFromLivePct <= CHART_PROXIMITY_PCT_BY_TF[timeframe];

  return {
    key,
    family,
    offset,
    price,
    polarity,
    isPierced,
    autourZone,
    autourWeight,
    shouldPlotOnChart,
    referenceTime: refBar.time,
    referenceBucket: refBar.bucketKey,
    timeframe,
    label: `${timeframe}-${key}`,
    distancePct,
  };
}

/**
 * A. The "Jack" Indicator (M20 Baseline Matrix: t-21, t-20, t-19)
 */
export function calculateJackMatrix(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe,
  recentDailyBars?: OHLCVBar[]
): JackMatrix {
  return {
    Jack_Minus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Jack_Minus1',
      'Jack',
      21,
      recentDailyBars
    ),
    Jack_0: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Jack_0',
      'Jack',
      20,
      recentDailyBars
    ),
    Jack_Plus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Jack_Plus1',
      'Jack',
      19,
      recentDailyBars
    ),
  };
}

/**
 * B. The "Oggy" Indicator (M7 Baseline Matrix: t-8, t-7, t-6)
 */
export function calculateOggyMatrix(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe,
  recentDailyBars?: OHLCVBar[]
): OggyMatrix {
  return {
    Oggy_Minus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Oggy_Minus1',
      'Oggy',
      8,
      recentDailyBars
    ),
    Oggy_0: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Oggy_0',
      'Oggy',
      7,
      recentDailyBars
    ),
    Oggy_Plus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Oggy_Plus1',
      'Oggy',
      6,
      recentDailyBars
    ),
  };
}

export function flattenTimeframeBaselines(
  Jack: JackMatrix,
  Oggy: OggyMatrix,
  onlyUnpierced = false
): ATSBaseline[] {
  const all = [
    Jack.Jack_Minus1,
    Jack.Jack_0,
    Jack.Jack_Plus1,
    Oggy.Oggy_Minus1,
    Oggy.Oggy_0,
    Oggy.Oggy_Plus1,
  ].filter((line): line is ATSBaseline => line !== null);

  return onlyUnpierced ? all.filter((l) => !l.isPierced) : all;
}

/**
 * Simple Moving Average Series (M7 and M20 curves on AT.S charts).
 */
export function calculateSMASeries(
  bars: OHLCVBar[],
  period: number
): MovingAveragePoint[] {
  if (bars.length < period) return [];

  const points: MovingAveragePoint[] = [];
  let sum = 0;

  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) {
      sum -= bars[i - period].close;
    }
    if (i >= period - 1) {
      const value = sum / period;
      const prevValue =
        points.length > 0 ? points[points.length - 1].value : value;
      points.push({
        time: bars[i].time,
        value,
        isGreen: value >= prevValue,
      });
    }
  }

  return points;
}

/**
 * C1. Bollinger Bands (20 periods, 2 standard deviations).
 */
export function calculateBollingerBands(
  bars: OHLCVBar[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandPoint[] {
  if (bars.length < period) return [];

  const points: BollingerBandPoint[] = [];
  let rollingSum = 0;

  for (let i = 0; i < bars.length; i++) {
    rollingSum += bars[i].close;
    if (i >= period) {
      rollingSum -= bars[i - period].close;
    }

    if (i >= period - 1) {
      const mid = rollingSum / period;
      let sumSqDiff = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = bars[j].close - mid;
        sumSqDiff += diff * diff;
      }
      const stdDev = Math.sqrt(sumSqDiff / period);
      const upper = mid + stdDevMultiplier * stdDev;
      const lower = mid - stdDevMultiplier * stdDev;
      const bandwidth = mid > 0 ? (upper - lower) / mid : 0;

      const prev = points.length > 0 ? points[points.length - 1] : null;

      points.push({
        time: bars[i].time,
        upper,
        mid,
        lower,
        stdDev,
        bandwidth,
        upperGreen: prev ? upper >= prev.upper : true,
        midGreen: prev ? mid >= prev.mid : true,
        lowerGreen: prev ? lower >= prev.lower : true,
      });
    }
  }

  return points;
}

export function calculateTypicalBollingerBands(
  bars: OHLCVBar[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandPoint[] {
  if (bars.length < period) return [];
  const typicalBars: OHLCVBar[] = bars.map((b) => ({
    ...b,
    close: (b.high + b.low + b.close) / 3,
  }));
  return calculateBollingerBands(typicalBars, period, stdDevMultiplier);
}

export function detectBollingerCompression(
  bb: BollingerBandPoint[],
  currentPrice: number
): { oppositeBandCurvingInwards: boolean; bbCompressing: boolean } {
  if (bb.length < 2) {
    return { oppositeBandCurvingInwards: false, bbCompressing: false };
  }

  const curr = bb[bb.length - 1];
  const prev = bb[bb.length - 2];

  const bbCompressing = curr.bandwidth < prev.bandwidth;
  const oppositeBandCurvingInwards =
    currentPrice <= curr.mid
      ? curr.upper < prev.upper
      : curr.lower > prev.lower;

  return { oppositeBandCurvingInwards, bbCompressing };
}

/**
 * C2. Exact "SAR Wilder AT.S" matching the user's TradingView Pine Script:
 * - Plots `tmpSAR[1]` with `col = tendance[1] == 1 ? green : red`
 */
export function calculateParabolicSAR(
  bars: OHLCVBar[],
  increment = 0.02,
  maxfacteur = 0.2
): ParabolicSARPoint[] {
  if (bars.length === 0) return [];
  if (bars.length === 1) {
    return [
      {
        time: bars[0].time,
        value: bars[0].low,
        isBullish: true,
        isFlip: false,
        af: 0.02,
      },
    ];
  }

  const result: ParabolicSARPoint[] = [];

  let facteur = 0.02;
  let tmpSAR = bars[0].low;
  let extreme = bars[0].high;
  let tendance: 1 | -1 = 1;

  result.push({
    time: bars[0].time,
    value: tmpSAR,
    isBullish: true,
    isFlip: false,
    af: facteur,
  });

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const high1 = bars[i - 1].high;
    const low1 = bars[i - 1].low;

    const tmpsar1 = tmpSAR;
    const extreme1 = extreme;
    const tendance1 = tendance;

    const plottedBullish = tendance1 === 1;
    const prevBullish =
      result.length > 0 ? result[result.length - 1].isBullish : plottedBullish;

    result.push({
      time: bars[i].time,
      value: tmpsar1,
      isBullish: plottedBullish,
      isFlip: i >= 2 ? plottedBullish !== prevBullish : false,
      af: facteur,
    });

    if (tendance1 === 1) {
      extreme = Math.max(extreme1, high);
      if (tmpsar1 > low) {
        tendance = -1;
        facteur = 0.02;
        tmpSAR = extreme;
        extreme = low;
      } else {
        if (extreme > extreme1 && facteur < maxfacteur) {
          facteur = Math.min(maxfacteur, facteur + increment);
        }
        tmpSAR = tmpsar1 + facteur * (extreme - tmpsar1);
        tmpSAR = Math.min(tmpSAR, Math.min(low, low1));
      }
    } else {
      extreme = Math.min(extreme1, low);
      if (tmpsar1 < high) {
        tendance = 1;
        facteur = 0.02;
        tmpSAR = extreme;
        extreme = high;
      } else {
        if (extreme < extreme1 && facteur < maxfacteur) {
          facteur = Math.min(maxfacteur, facteur + increment);
        }
        tmpSAR = tmpsar1 + facteur * (extreme - tmpsar1);
        tmpSAR = Math.max(tmpSAR, Math.max(high, high1));
      }
    }
  }

  return result;
}

/**
 * Étape 2 — Tracé de Dee-Dee (Didi):
 * Identifies the short-term control threshold to reclaim (Bull) or break (Bear),
 * falling back to nearest unpierced resistance/support.
 */
export function calculateLocalDidi(
  timeframe: Timeframe,
  Jack: JackMatrix,
  Oggy: OggyMatrix,
  latestSMA7: MovingAveragePoint | null,
  latestBB: BollingerBandPoint | null,
  currentPrice: number
): DidiTarget | null {
  const minThreshold = currentPrice * 1.0005;
  const candidates: DidiTarget[] = [];

  // Short-term Oggy / Jack control thresholds above price
  for (const line of flattenTimeframeBaselines(Jack, Oggy, true)) {
    if (line.price > minThreshold) {
      candidates.push({
        price: line.price,
        label: line.label,
        timeframe,
        sourceType: line.family === 'Jack' ? 'Red_Jack' : 'Red_Oggy',
        upsidePct: ((line.price - currentPrice) / currentPrice) * 100,
      });
    }
  }

  // Intermediate M7 (SMA7) target
  if (latestSMA7 && latestSMA7.value > minThreshold) {
    candidates.push({
      price: latestSMA7.value,
      label: `${timeframe}-M7`,
      timeframe,
      sourceType: 'SMA7',
      upsidePct: ((latestSMA7.value - currentPrice) / currentPrice) * 100,
    });
  }

  if (latestBB && latestBB.upper > minThreshold) {
    candidates.push({
      price: latestBB.upper,
      label: `${timeframe}-BB_Upper`,
      timeframe,
      sourceType: 'HTF_BB_Upper',
      upsidePct: ((latestBB.upper - currentPrice) / currentPrice) * 100,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.price - b.price);
  return candidates[0];
}

export function calculateLocalDownsideDidi(
  timeframe: Timeframe,
  Jack: JackMatrix,
  Oggy: OggyMatrix,
  latestSMA7: MovingAveragePoint | null,
  latestBB: BollingerBandPoint | null,
  currentPrice: number
): DidiTarget | null {
  const maxThreshold = currentPrice * 0.9995;
  const candidates: DidiTarget[] = [];

  for (const line of flattenTimeframeBaselines(Jack, Oggy, true)) {
    if (line.price < maxThreshold) {
      candidates.push({
        price: line.price,
        label: line.label,
        timeframe,
        sourceType: line.family === 'Jack' ? 'Green_Jack' : 'Green_Oggy',
        upsidePct: ((currentPrice - line.price) / currentPrice) * 100,
      });
    }
  }

  if (latestSMA7 && latestSMA7.value < maxThreshold) {
    candidates.push({
      price: latestSMA7.value,
      label: `${timeframe}-M7`,
      timeframe,
      sourceType: 'SMA7',
      upsidePct: ((currentPrice - latestSMA7.value) / currentPrice) * 100,
    });
  }

  if (latestBB && latestBB.lower < maxThreshold && latestBB.lower > 0) {
    candidates.push({
      price: latestBB.lower,
      label: `${timeframe}-BB_Lower`,
      timeframe,
      sourceType: 'HTF_BB_Lower',
      upsidePct: ((currentPrice - latestBB.lower) / currentPrice) * 100,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.price - a.price);
  return candidates[0];
}

const EMPTY_SETUP_1234: TimeframeSetup1234 = {
  status: 'NONE',
  isBull: true,
  signalBarTime: null,
  signalPriceLevel: null,
  confluenceText: '',
  tp1Sma7: null,
  tp2Sma20: null,
  tp1Hit: false,
  tp2Hit: false,
};

export function calculateTimeframeATS(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe,
  recentDailyBars?: OHLCVBar[]
): TimeframeATSData {
  const Jack = calculateJackMatrix(
    bars,
    currentPrice,
    timeframe,
    recentDailyBars
  );
  const Oggy = calculateOggyMatrix(
    bars,
    currentPrice,
    timeframe,
    recentDailyBars
  );

  const sma7 = calculateSMASeries(bars, 7);
  const sma20 = calculateSMASeries(bars, 20);
  const latestSMA7 = sma7.length > 0 ? sma7[sma7.length - 1] : null;
  const latestSMA20 = sma20.length > 0 ? sma20[sma20.length - 1] : null;

  const bollingerBands = calculateBollingerBands(bars, 20, 2);
  const latestBB =
    bollingerBands.length > 0
      ? bollingerBands[bollingerBands.length - 1]
      : null;
  const { oppositeBandCurvingInwards, bbCompressing } =
    detectBollingerCompression(bollingerBands, currentPrice);

  const parabolicSAR = calculateParabolicSAR(bars, 0.02, 0.2);
  const latestSAR =
    parabolicSAR.length > 0 ? parabolicSAR[parabolicSAR.length - 1] : null;
  const prevSAR =
    parabolicSAR.length > 1 ? parabolicSAR[parabolicSAR.length - 2] : null;

  const sarFlippedBullishRecently = Boolean(
    (latestSAR && latestSAR.isBullish && latestSAR.isFlip) ||
      (prevSAR && prevSAR.isBullish && prevSAR.isFlip && latestSAR?.isBullish)
  );

  const sarFlippedBearishRecently = Boolean(
    (latestSAR && !latestSAR.isBullish && latestSAR.isFlip) ||
      (prevSAR && !prevSAR.isBullish && prevSAR.isFlip && !latestSAR?.isBullish)
  );

  const Didi = calculateLocalDidi(
    timeframe,
    Jack,
    Oggy,
    latestSMA7,
    latestBB,
    currentPrice
  );

  return {
    timeframe,
    bars,
    Jack,
    Oggy,
    sma7,
    sma20,
    latestSMA7,
    latestSMA20,
    bollingerBands,
    latestBB,
    oppositeBandCurvingInwards,
    bbCompressing,
    parabolicSAR,
    latestSAR,
    sarFlippedBullishRecently,
    sarFlippedBearishRecently,
    Didi,
    setup1234: EMPTY_SETUP_1234,
  };
}

/**
 * Port of `setup1234.pine` signal detection across timeframes:
 * - Checks Higher-Timeframe "Autour" confluences (Oggy/Jack, M7, M20, SAR Wilder, BB Low/High + hlc3 BB)
 * - Active age window: up to `confirmed_max_age = 8` daily bars (provided TP2 SMA20 not yet closed across & SL intact)
 * - Signal Orange (CANDIDATE): setup detected at HTF macro level, awaiting opposite BB turn
 * - Signal Vert/Rouge (CONFIRMED): opposite BB has turned inward (Phase 3)
 * - Materializes the 2 black target dots (`2 billes noires`): TP1 = SMA 7, TP2 = SMA 20
 */
function populateSetup1234Signals(
  timeframes: Record<Timeframe, TimeframeATSData>,
  currentPrice: number
): void {
  for (const tf of ALL_TIMEFRAMES) {
    const tfData = timeframes[tf];
    const bars = tfData.bars;
    if (bars.length < 20 || !tfData.latestSMA7 || !tfData.latestSMA20) {
      continue;
    }

    const tfIdx = TIMEFRAME_ORDER_INDEX[tf];
    const higherTfs = ALL_TIMEFRAMES.filter(
      (candidate) => TIMEFRAME_ORDER_INDEX[candidate] > tfIdx
    );
    if (higherTfs.length === 0) continue;

    const maxAge = tf === 'D' ? 5 : 1;
    const maxLookback = Math.min(maxAge, bars.length - 2);
    const sma20Offset = bars.length - tfData.sma20.length;
    const bbOffset = bars.length - tfData.bollingerBands.length;

    let bestSignalBarIdx = -1;
    let isBullSetup = true;
    let chosenConfluences: string[] = [];

    for (let lb = 0; lb <= maxLookback; lb++) {
      const barIdx = bars.length - 1 - lb;
      const testBar = bars[barIdx];
      const bbIdx = barIdx - bbOffset;
      const bbAtBar =
        bbIdx >= 0 && bbIdx < tfData.bollingerBands.length
          ? tfData.bollingerBands[bbIdx]
          : tfData.latestBB;

      // For historical bars (lb > 0), strictly require Bollinger Band excess per setup1234.pine lines 374 & 376
      let bullStillValid =
        lb === 0 || Boolean(bbAtBar && testBar.low <= bbAtBar.lower * 1.002);
      let bearStillValid =
        lb === 0 || Boolean(bbAtBar && testBar.high >= bbAtBar.upper * 0.998);

      if (lb > 0) {
        const bullInvalidFloor = testBar.low * 0.995;
        const bearInvalidCeil = testBar.high * 1.005;
        for (let k = barIdx + 1; k < bars.length; k++) {
          const s20Idx = k - sma20Offset;
          const s20AtK =
            s20Idx >= 0 && s20Idx < tfData.sma20.length
              ? tfData.sma20[s20Idx].value
              : tfData.latestSMA20.value;

          if (bars[k].close < bullInvalidFloor || bars[k].close >= s20AtK) {
            bullStillValid = false;
          }
          if (bars[k].close > bearInvalidCeil || bars[k].close <= s20AtK) {
            bearStillValid = false;
          }
        }
      }

      if (!bullStillValid && !bearStillValid) continue;

      const bullHits: string[] = [];
      const bearHits: string[] = [];

      for (const htf of higherTfs) {
        const htfData = timeframes[htf];
        const tolApp = htf === 'W' || htf === 'M' ? 0.012 : 0.014;
        const tolBrk = (AUTOUR_OVERSHOOT_TOL_PCT[htf] || 1.2) / 100;

        const isNearBull = (level: number) =>
          bullStillValid &&
          level > 0 &&
          currentPrice >= level * (1 - tolBrk) &&
          (testBar.low < level
            ? level - testBar.low <= testBar.close * tolBrk
            : testBar.low - level <= testBar.close * tolApp);

        const isNearBear = (level: number) =>
          bearStillValid &&
          level > 0 &&
          currentPrice <= level * (1 + tolBrk) &&
          (testBar.high > level
            ? testBar.high - level <= testBar.close * tolBrk
            : level - testBar.high <= testBar.close * tolApp);

        // 1. Unpierced HTF Oggy & Jack baselines
        for (const line of flattenTimeframeBaselines(
          htfData.Jack,
          htfData.Oggy,
          true
        )) {
          if (line.polarity === 'GREEN' && isNearBull(line.price)) {
            bullHits.push(line.label);
          } else if (line.polarity === 'RED' && isNearBear(line.price)) {
            bearHits.push(line.label);
          }
        }

        // 2. HTF Dynamic M7 & M20
        if (htfData.latestSMA7) {
          if (
            htfData.latestSMA7.isGreen &&
            isNearBull(htfData.latestSMA7.value)
          ) {
            bullHits.push(`${htf}-M7`);
          } else if (
            !htfData.latestSMA7.isGreen &&
            isNearBear(htfData.latestSMA7.value)
          ) {
            bearHits.push(`${htf}-M7`);
          }
        }
        if (htfData.latestSMA20) {
          if (
            htfData.latestSMA20.isGreen &&
            isNearBull(htfData.latestSMA20.value)
          ) {
            bullHits.push(`${htf}-M20`);
          } else if (
            !htfData.latestSMA20.isGreen &&
            isNearBear(htfData.latestSMA20.value)
          ) {
            bearHits.push(`${htf}-M20`);
          }
        }

        // 3. HTF Wilder SAR
        if (htfData.latestSAR) {
          if (
            htfData.latestSAR.isBullish &&
            isNearBull(htfData.latestSAR.value)
          ) {
            bullHits.push(`${htf}-SAR`);
          } else if (
            !htfData.latestSAR.isBullish &&
            isNearBear(htfData.latestSAR.value)
          ) {
            bearHits.push(`${htf}-SAR`);
          }
        }

        // 4. HTF Bollinger Lower / Upper Band (strict slope: lowerGreen for Bull, !upperGreen for Bear)
        if (htfData.latestBB) {
          if (
            htfData.latestBB.lowerGreen &&
            isNearBull(htfData.latestBB.lower)
          ) {
            bullHits.push(`${htf}-BBLow`);
          } else if (
            !htfData.latestBB.upperGreen &&
            isNearBear(htfData.latestBB.upper)
          ) {
            bearHits.push(`${htf}-BBHigh`);
          }
        }
      }

      if (bullHits.length > 0 || bearHits.length > 0) {
        bestSignalBarIdx = barIdx;
        isBullSetup = bullHits.length >= bearHits.length;
        chosenConfluences = isBullSetup ? bullHits : bearHits;
        if (chosenConfluences.length > 0) break;
      }
    }

    if (bestSignalBarIdx < 0 || chosenConfluences.length === 0) continue;

    const signalBar = bars[bestSignalBarIdx];
    const bbArr = tfData.bollingerBands;
    const bbCurr = bbArr.length >= 1 ? bbArr[bbArr.length - 1] : null;
    const bbPrev = bbArr.length >= 2 ? bbArr[bbArr.length - 2] : null;

    // Étape 3 confirmation: opposite Bollinger Band curving inward on CURRENT bar
    const isConfirmed = Boolean(
      bbCurr &&
        bbPrev &&
        (isBullSetup
          ? bbCurr.upper < bbPrev.upper
          : bbCurr.lower > bbPrev.lower)
    );

    const tp1Sma7 = tfData.latestSMA7.value;
    const tp2Sma20 = tfData.latestSMA20.value;

    let tp1Hit = false;
    let tp2Hit = false;
    for (let k = bestSignalBarIdx; k < bars.length; k++) {
      if (isBullSetup) {
        if (bars[k].high >= tp1Sma7) tp1Hit = true;
        if (bars[k].high >= tp2Sma20) tp2Hit = true;
      } else {
        if (bars[k].low <= tp1Sma7) tp1Hit = true;
        if (bars[k].low <= tp2Sma20) tp2Hit = true;
      }
    }

    tfData.setup1234 = {
      status: isConfirmed ? 'CONFIRMED' : 'CANDIDATE',
      isBull: isBullSetup,
      signalBarTime: signalBar.time,
      signalPriceLevel: isBullSetup ? signalBar.low : signalBar.high,
      confluenceText: Array.from(new Set(chosenConfluences))
        .slice(0, 5)
        .join(', '),
      tp1Sma7,
      tp2Sma20,
      tp1Hit,
      tp2Hit,
    };
  }
}

export function calculateGlobalDidi(
  timeframes: Record<Timeframe, TimeframeATSData>,
  currentPrice: number
): DidiTarget | null {
  // Prefer Trigger/Short-term intermediate M7 or short-term control threshold (Étape 2/4),
  // else nearest unpierced HTF resistance
  if (
    timeframes.D.latestSMA7 &&
    timeframes.D.latestSMA7.value > currentPrice * 1.004
  ) {
    return {
      price: timeframes.D.latestSMA7.value,
      label: 'D-M7 (Bille 1)',
      timeframe: 'D',
      sourceType: 'SMA7',
      upsidePct:
        ((timeframes.D.latestSMA7.value - currentPrice) / currentPrice) * 100,
    };
  }

  const minThreshold = currentPrice * 1.002;
  const htfCandidates: DidiTarget[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    if (tfData.latestSMA7 && tfData.latestSMA7.value > minThreshold) {
      htfCandidates.push({
        price: tfData.latestSMA7.value,
        label: `${tf}-M7`,
        timeframe: tf,
        sourceType: 'SMA7',
        upsidePct:
          ((tfData.latestSMA7.value - currentPrice) / currentPrice) * 100,
      });
    }
    for (const line of flattenTimeframeBaselines(
      tfData.Jack,
      tfData.Oggy,
      true
    )) {
      if (line.polarity === 'RED' && line.price > minThreshold) {
        htfCandidates.push({
          price: line.price,
          label: line.label,
          timeframe: tf,
          sourceType: line.family === 'Jack' ? 'Red_Jack' : 'Red_Oggy',
          upsidePct: ((line.price - currentPrice) / currentPrice) * 100,
        });
      }
    }
    if (tfData.latestBB && tfData.latestBB.upper > minThreshold) {
      htfCandidates.push({
        price: tfData.latestBB.upper,
        label: `${tf}-BB_Upper`,
        timeframe: tf,
        sourceType: 'HTF_BB_Upper',
        upsidePct: ((tfData.latestBB.upper - currentPrice) / currentPrice) * 100,
      });
    }
  }

  if (htfCandidates.length > 0) {
    htfCandidates.sort((a, b) => a.price - b.price);
    return htfCandidates[0];
  }

  return timeframes.D.Didi;
}

export function calculateGlobalDownsideDidi(
  timeframes: Record<Timeframe, TimeframeATSData>,
  currentPrice: number
): DidiTarget | null {
  if (
    timeframes.D.latestSMA7 &&
    timeframes.D.latestSMA7.value < currentPrice * 0.996
  ) {
    return {
      price: timeframes.D.latestSMA7.value,
      label: 'D-M7 (Bille 1)',
      timeframe: 'D',
      sourceType: 'SMA7',
      upsidePct:
        ((currentPrice - timeframes.D.latestSMA7.value) / currentPrice) * 100,
    };
  }

  const maxThreshold = currentPrice * 0.998;
  const htfCandidates: DidiTarget[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    if (tfData.latestSMA7 && tfData.latestSMA7.value < maxThreshold) {
      htfCandidates.push({
        price: tfData.latestSMA7.value,
        label: `${tf}-M7`,
        timeframe: tf,
        sourceType: 'SMA7',
        upsidePct:
          ((currentPrice - tfData.latestSMA7.value) / currentPrice) * 100,
      });
    }
    for (const line of flattenTimeframeBaselines(
      tfData.Jack,
      tfData.Oggy,
      true
    )) {
      if (line.polarity === 'GREEN' && line.price < maxThreshold) {
        htfCandidates.push({
          price: line.price,
          label: line.label,
          timeframe: tf,
          sourceType: line.family === 'Jack' ? 'Green_Jack' : 'Green_Oggy',
          upsidePct: ((currentPrice - line.price) / currentPrice) * 100,
        });
      }
    }
    if (
      tfData.latestBB &&
      tfData.latestBB.lower < maxThreshold &&
      tfData.latestBB.lower > 0
    ) {
      htfCandidates.push({
        price: tfData.latestBB.lower,
        label: `${tf}-BB_Lower`,
        timeframe: tf,
        sourceType: 'HTF_BB_Lower',
        upsidePct: ((currentPrice - tfData.latestBB.lower) / currentPrice) * 100,
      });
    }
  }

  if (htfCandidates.length > 0) {
    htfCandidates.sort((a, b) => b.price - a.price);
    return htfCandidates[0];
  }

  return calculateLocalDownsideDidi(
    'D',
    timeframes.D.Jack,
    timeframes.D.Oggy,
    timeframes.D.latestSMA7,
    timeframes.D.latestBB,
    currentPrice
  );
}

export function computeAllTimeframesATS(
  resampledBars: Record<Timeframe, OHLCVBar[]>,
  currentPrice: number
): {
  timeframes: Record<Timeframe, TimeframeATSData>;
  Didi: DidiTarget | null;
  downsideDidi: DidiTarget | null;
} {
  const timeframes = {} as Record<Timeframe, TimeframeATSData>;
  const recentDailyBars = resampledBars.D.slice(-16);

  for (const tf of ALL_TIMEFRAMES) {
    timeframes[tf] = calculateTimeframeATS(
      resampledBars[tf],
      currentPrice,
      tf,
      recentDailyBars
    );
  }

  populateSetup1234Signals(timeframes, currentPrice);

  const Didi = calculateGlobalDidi(timeframes, currentPrice);
  const downsideDidi = calculateGlobalDownsideDidi(timeframes, currentPrice);
  return { timeframes, Didi, downsideDidi };
}
