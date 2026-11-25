import { ALL_TIMEFRAMES, HIGHER_TIMEFRAMES } from '../types/ats.ts';
import type {
  ATSBaseline,
  ATSLineKey,
  ATSPolarity,
  BollingerBandPoint,
  DidiTarget,
  JackMatrix,
  OggyMatrix,
  OHLCVBar,
  ParabolicSARPoint,
  Timeframe,
  TimeframeATSData,
} from '../types/ats.ts';

/**
 * Determines ATS Polarity strictly by comparing CURRENT live price
 * to the historical close baseline:
 * - Current Price >= Historical Close => GREEN (Support)
 * - Current Price <  Historical Close => RED (Resistance)
 */
export function resolveATSPolarity(
  currentPrice: number,
  historicalClose: number
): ATSPolarity {
  return currentPrice >= historicalClose ? 'GREEN' : 'RED';
}

function buildBaseline(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe,
  key: ATSLineKey,
  family: 'Jack' | 'Oggy',
  offset: number
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

  const polarity = resolveATSPolarity(currentPrice, price);
  const distancePct = ((currentPrice - price) / price) * 100;

  return {
    key,
    family,
    offset,
    price,
    polarity,
    referenceTime: refBar.time,
    referenceBucket: refBar.bucketKey,
    timeframe,
    label: `${timeframe}-${key}`,
    distancePct,
  };
}

/**
 * A. The "Jack" Indicator (M20 Baseline Matrix):
 * - Jack_Minus1: Close price at t-21
 * - Jack_0:      Close price at t-20
 * - Jack_Plus1:  Close price at t-19
 */
export function calculateJackMatrix(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe
): JackMatrix {
  return {
    Jack_Minus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Jack_Minus1',
      'Jack',
      21
    ),
    Jack_0: buildBaseline(bars, currentPrice, timeframe, 'Jack_0', 'Jack', 20),
    Jack_Plus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Jack_Plus1',
      'Jack',
      19
    ),
  };
}

/**
 * B. The "Oggy" Indicator (M7 Baseline Matrix):
 * - Oggy_Minus1: Close price at t-8
 * - Oggy_0:      Close price at t-7
 * - Oggy_Plus1:  Close price at t-6
 */
export function calculateOggyMatrix(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe
): OggyMatrix {
  return {
    Oggy_Minus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Oggy_Minus1',
      'Oggy',
      8
    ),
    Oggy_0: buildBaseline(bars, currentPrice, timeframe, 'Oggy_0', 'Oggy', 7),
    Oggy_Plus1: buildBaseline(
      bars,
      currentPrice,
      timeframe,
      'Oggy_Plus1',
      'Oggy',
      6
    ),
  };
}

/**
 * Extracts all non-null Jack & Oggy baselines for a given timeframe.
 */
export function flattenTimeframeBaselines(
  Jack: JackMatrix,
  Oggy: OggyMatrix
): ATSBaseline[] {
  return [
    Jack.Jack_Minus1,
    Jack.Jack_0,
    Jack.Jack_Plus1,
    Oggy.Oggy_Minus1,
    Oggy.Oggy_0,
    Oggy.Oggy_Plus1,
  ].filter((line): line is ATSBaseline => line !== null);
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

      points.push({
        time: bars[i].time,
        upper,
        mid,
        lower,
        stdDev,
        bandwidth,
      });
    }
  }

  return points;
}

/**
 * Bidirectional ATS Step 3 Volatility Reversal check:
 * - Below mid (bearish drop into support): opposite band is Upper BB curving downward (curr.upper < prev.upper)
 * - Above mid (bullish rally into resistance): opposite band is Lower BB curving upward (curr.lower > prev.lower)
 */
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
 * C2. Parabolic SAR (Step = 0.02, Max = 0.20).
 */
export function calculateParabolicSAR(
  bars: OHLCVBar[],
  afStep = 0.02,
  afMax = 0.2
): ParabolicSARPoint[] {
  if (bars.length === 0) return [];
  if (bars.length === 1) {
    return [
      {
        time: bars[0].time,
        value: bars[0].low,
        isBullish: true,
        isFlip: false,
        af: afStep,
      },
    ];
  }

  const result: ParabolicSARPoint[] = [];

  let isBullish = bars[1].close >= bars[0].close;
  let sar = isBullish ? bars[0].low : bars[0].high;
  let ep = isBullish
    ? Math.max(bars[0].high, bars[1].high)
    : Math.min(bars[0].low, bars[1].low);
  let af = afStep;

  result.push({
    time: bars[0].time,
    value: sar,
    isBullish,
    isFlip: false,
    af,
  });

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar1 = bars[i - 1];
    const prevBar2 = i >= 2 ? bars[i - 2] : bars[i - 1];

    let nextSar = sar + af * (ep - sar);
    let flipped = false;

    if (isBullish) {
      nextSar = Math.min(nextSar, prevBar1.low, prevBar2.low);

      if (bar.low < nextSar) {
        isBullish = false;
        flipped = true;
        nextSar = Math.max(ep, bar.high);
        ep = bar.low;
        af = afStep;
      } else if (bar.high > ep) {
        ep = bar.high;
        af = Math.min(af + afStep, afMax);
      }
    } else {
      nextSar = Math.max(nextSar, prevBar1.high, prevBar2.high);

      if (bar.high > nextSar) {
        isBullish = true;
        flipped = true;
        nextSar = Math.min(ep, bar.low);
        ep = bar.high;
        af = afStep;
      } else if (bar.low < ep) {
        ep = bar.low;
        af = Math.min(af + afStep, afMax);
      }
    }

    sar = nextSar;
    result.push({
      time: bar.time,
      value: sar,
      isBullish,
      isFlip: flipped,
      af,
    });
  }

  return result;
}

/**
 * Calculates local overhead Didi candidate on a single timeframe.
 */
export function calculateLocalDidi(
  timeframe: Timeframe,
  Jack: JackMatrix,
  Oggy: OggyMatrix,
  latestBB: BollingerBandPoint | null,
  currentPrice: number
): DidiTarget | null {
  const minThreshold = currentPrice * 1.0005;
  const candidates: DidiTarget[] = [];

  for (const line of flattenTimeframeBaselines(Jack, Oggy)) {
    if (line.polarity === 'RED' && line.price > minThreshold) {
      candidates.push({
        price: line.price,
        label: line.label,
        timeframe,
        sourceType: line.family === 'Jack' ? 'Red_Jack' : 'Red_Oggy',
        upsidePct: ((line.price - currentPrice) / currentPrice) * 100,
      });
    }
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
  latestBB: BollingerBandPoint | null,
  currentPrice: number
): DidiTarget | null {
  const maxThreshold = currentPrice * 0.9995;
  const candidates: DidiTarget[] = [];

  for (const line of flattenTimeframeBaselines(Jack, Oggy)) {
    if (line.polarity === 'GREEN' && line.price < maxThreshold) {
      candidates.push({
        price: line.price,
        label: line.label,
        timeframe,
        sourceType: line.family === 'Jack' ? 'Green_Jack' : 'Green_Oggy',
        upsidePct: ((currentPrice - line.price) / currentPrice) * 100,
      });
    }
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

/**
 * Calculates all ATS indicators independently for a single timeframe.
 */
export function calculateTimeframeATS(
  bars: OHLCVBar[],
  currentPrice: number,
  timeframe: Timeframe
): TimeframeATSData {
  const Jack = calculateJackMatrix(bars, currentPrice, timeframe);
  const Oggy = calculateOggyMatrix(bars, currentPrice, timeframe);

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

  const Didi = calculateLocalDidi(timeframe, Jack, Oggy, latestBB, currentPrice);

  return {
    timeframe,
    bars,
    Jack,
    Oggy,
    bollingerBands,
    latestBB,
    oppositeBandCurvingInwards,
    bbCompressing,
    parabolicSAR,
    latestSAR,
    sarFlippedBullishRecently,
    sarFlippedBearishRecently,
    Didi,
  };
}

/**
 * Global MTF Overhead Didi (TP1 for LONG setups):
 * Nearest overhead resistance across Higher Timeframes (Red Jack, Red Oggy, or HTF Upper BB).
 */
export function calculateGlobalDidi(
  timeframes: Record<Timeframe, TimeframeATSData>,
  currentPrice: number
): DidiTarget | null {
  const minThreshold = currentPrice * 1.001;
  const htfCandidates: DidiTarget[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    for (const line of flattenTimeframeBaselines(tfData.Jack, tfData.Oggy)) {
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

/**
 * Global MTF Downside Didi (TP1 for SHORT Resistance Rejection setups):
 * Nearest underlying support across Higher Timeframes (Green Jack, Green Oggy, or HTF Lower BB).
 */
export function calculateGlobalDownsideDidi(
  timeframes: Record<Timeframe, TimeframeATSData>,
  currentPrice: number
): DidiTarget | null {
  const maxThreshold = currentPrice * 0.999;
  const htfCandidates: DidiTarget[] = [];

  for (const tf of HIGHER_TIMEFRAMES) {
    const tfData = timeframes[tf];
    for (const line of flattenTimeframeBaselines(tfData.Jack, tfData.Oggy)) {
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
    timeframes.D.latestBB,
    currentPrice
  );
}

/**
 * Runs independent ATS indicator computation across all 6 timeframes (D, W, M, 3M, 6M, 12M).
 */
export function computeAllTimeframesATS(
  resampledBars: Record<Timeframe, OHLCVBar[]>,
  currentPrice: number
): {
  timeframes: Record<Timeframe, TimeframeATSData>;
  Didi: DidiTarget | null;
  downsideDidi: DidiTarget | null;
} {
  const timeframes = {} as Record<Timeframe, TimeframeATSData>;

  for (const tf of ALL_TIMEFRAMES) {
    timeframes[tf] = calculateTimeframeATS(
      resampledBars[tf],
      currentPrice,
      tf
    );
  }

  const Didi = calculateGlobalDidi(timeframes, currentPrice);
  const downsideDidi = calculateGlobalDownsideDidi(timeframes, currentPrice);
  return { timeframes, Didi, downsideDidi };
}
