export type AssetCategory = 'stocks' | 'crypto' | 'forex';

export type Timeframe = 'D' | 'W' | 'M' | '3M' | '6M' | '12M';

export const ALL_TIMEFRAMES: readonly Timeframe[] = [
  'D',
  'W',
  'M',
  '3M',
  '6M',
  '12M',
] as const;
export const HIGHER_TIMEFRAMES: readonly Timeframe[] = [
  'W',
  'M',
  '3M',
  '6M',
  '12M',
] as const;

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  D: 'Daily (D)',
  W: 'Weekly (W)',
  M: 'Monthly (M)',
  '3M': 'Quarterly (3M)',
  '6M': 'Bi-Annual (6M)',
  '12M': 'Annual (12M)',
};

export type ATSPolarity = 'GREEN' | 'RED';
export type SetupDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type JackLineKey = 'Jack_Minus1' | 'Jack_0' | 'Jack_Plus1';
export type OggyLineKey = 'Oggy_Minus1' | 'Oggy_0' | 'Oggy_Plus1';
export type ATSLineKey = JackLineKey | OggyLineKey;

export interface DailyOHLCV {
  /** UTC Calendar Date in YYYY-MM-DD format */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCVBar extends DailyOHLCV {
  /** Period grouping identifier (e.g., 2026-W48, 2026-11, 2026-Q4, 2026-H2, 2026) */
  bucketKey: string;
  /** Canonical period start date YYYY-MM-DD */
  periodStart: string;
  /** Last observed daily bar date in this bucket YYYY-MM-DD */
  periodEnd: string;
}

export interface ATSBaseline {
  key: ATSLineKey;
  family: 'Jack' | 'Oggy';
  /** Lookback offset in bars (21, 20, 19 for Jack; 8, 7, 6 for Oggy) */
  offset: number;
  /** Historical closing price at t - offset */
  price: number;
  /** GREEN = Support (currentPrice >= price), RED = Resistance (currentPrice < price) */
  polarity: ATSPolarity;
  /** Historical bar date at t - offset */
  referenceTime: string;
  /** Historical bucket label at t - offset */
  referenceBucket: string;
  timeframe: Timeframe;
  /** Formatted MTF line identifier, e.g. "M-Jack_0" or "W-Oggy_Minus1" */
  label: string;
  /** Signed percentage distance from baseline: ((currentPrice - price) / price) * 100 */
  distancePct: number;
}

export interface JackMatrix {
  Jack_Minus1: ATSBaseline | null;
  Jack_0: ATSBaseline | null;
  Jack_Plus1: ATSBaseline | null;
}

export interface OggyMatrix {
  Oggy_Minus1: ATSBaseline | null;
  Oggy_0: ATSBaseline | null;
  Oggy_Plus1: ATSBaseline | null;
}

export interface BollingerBandPoint {
  time: string;
  upper: number;
  mid: number;
  lower: number;
  stdDev: number;
  bandwidth: number;
}

export interface ParabolicSARPoint {
  time: string;
  value: number;
  /** true = dots below price (bullish trend), false = dots above price (bearish trend) */
  isBullish: boolean;
  /** true when SAR switched polarity on this specific bar */
  isFlip: boolean;
  af: number;
}

export interface DidiTarget {
  price: number;
  label: string;
  timeframe: Timeframe;
  sourceType:
    | 'Red_Jack'
    | 'Red_Oggy'
    | 'HTF_BB_Upper'
    | 'Green_Jack'
    | 'Green_Oggy'
    | 'HTF_BB_Lower';
  /** Absolute move % toward target from livePrice */
  upsidePct: number;
}

export interface TimeframeATSData {
  timeframe: Timeframe;
  bars: OHLCVBar[];
  Jack: JackMatrix;
  Oggy: OggyMatrix;
  bollingerBands: BollingerBandPoint[];
  latestBB: BollingerBandPoint | null;
  /** Step 3 check: whether the opposite Bollinger Band has started curving inwards */
  oppositeBandCurvingInwards: boolean;
  /** Overall Bollinger bandwidth contraction on latest bar */
  bbCompressing: boolean;
  parabolicSAR: ParabolicSARPoint[];
  latestSAR: ParabolicSARPoint | null;
  /** Whether SAR flipped bullish on recent bar */
  sarFlippedBullishRecently: boolean;
  /** Whether SAR flipped bearish on recent bar */
  sarFlippedBearishRecently: boolean;
  /** Nearest overhead resistance on this specific timeframe */
  Didi: DidiTarget | null;
}

export interface MacroTargetTP2 {
  price: number;
  label: string;
  timeframe: Timeframe;
  /** Signed % move from livePrice to M20 */
  upsidePct: number;
}

export interface TimeframeHorizonSummary {
  timeframe: Timeframe;
  greenCount: number;
  redCount: number;
  greenLines: string[];
  redLines: string[];
  /** Any Jack/Oggy lines within 1.0% proximity on this timeframe */
  wallTouches: Array<{
    shortName: string;
    label: string;
    polarity: ATSPolarity;
    price: number;
    absDistancePct: number;
  }>;
  bbState: 'CURVING_IN' | 'COMPRESSING' | 'EXPANDING' | 'NA';
  sarState: 'BULL_FLIP' | 'BEAR_FLIP' | 'BULL' | 'BEAR' | 'NA';
  m20Price: number | null;
}

export interface ScreenerResult {
  symbol: string;
  displaySymbol: string;
  name?: string;
  category: AssetCategory;
  livePrice: number;
  change24hPct: number;
  /** Setup trade bias: LONG (at Green Support Wall), SHORT (at Red Resistance Wall), or NEUTRAL */
  direction: SetupDirection;
  /** True when touching either a Support Wall (<=1%) or Resistance Wall (<=1%) */
  isAtWall: boolean;
  isAtSupportWall: boolean;
  isAtResistanceWall: boolean;
  /** Primary active MTF wall line label (e.g., "M-Jack_0") */
  activeWallLabel: string;
  /** Price of the primary Wall (Support or Resistance) */
  wallPrice: number | null;
  /** Absolute percentage proximity to the primary Wall */
  wallProximityPct: number | null;
  /** Overlapping HTF Green Support lines within 1% below livePrice */
  confluentWallLines: ATSBaseline[];
  /** Overlapping HTF Red Resistance lines within 1% above livePrice */
  confluentResistanceLines: ATSBaseline[];
  /** Nearest HTF Green support overall */
  nearestGreenSupport: ATSBaseline | null;
  /** Nearest HTF Red resistance overall */
  nearestRedResistance: ATSBaseline | null;
  /** Confidence Score (0 - 100) */
  confidenceScore: number;
  /** Current completed ATS Setup Step (0 to 4) */
  setupStep: 0 | 1 | 2 | 3 | 4;
  stepFlags: {
    step1Wall: boolean;
    step2Didi: boolean;
    step3VolatilityReversal: boolean;
    step4MacroM20: boolean;
  };
  /** Volatility reversal detail */
  volatilitySignal: string;
  /** Stop Loss (1% below Support Wall for LONG, 1% above Resistance Wall for SHORT) */
  stopLoss: number;
  /** Risk percentage from livePrice to stopLoss */
  riskPct: number;
  /** Overhead resistance target (TP1 for LONG) */
  Didi: DidiTarget | null;
  /** Downside support target (TP1 for SHORT) */
  downsideDidi: DidiTarget | null;
  /** Active TP1 target aligned with setup direction (Didi for LONG, downsideDidi for SHORT) */
  effectiveTargetTP1: DidiTarget | null;
  /** Step 4: Macro Target (TP2 - Higher Timeframe M20) */
  macroTargetTP2: MacroTargetTP2 | null;
  /** Reward-to-Risk ratio to effectiveTargetTP1 */
  riskRewardRatio: number | null;
  /** Per-timeframe (D, W, M, 3M, 6M, 12M) support/resistance indicator breakdown */
  horizonMatrix: Record<Timeframe, TimeframeHorizonSummary>;
  /** Concise 1-line quantitative thesis explaining why this candidate ranks where it does */
  thesisHeadline: string;
  /** Detailed bullet points explaining Support/Resistance confluence, Volatility, and Targets */
  reasoningBullets: string[];
}

export interface MTFAssetPayload {
  symbol: string;
  displaySymbol: string;
  name: string;
  category: AssetCategory;
  currency: string;
  livePrice: number;
  change24hPct: number;
  updatedAt: string;
  source: string;
  timeframes: Record<Timeframe, TimeframeATSData>;
  Didi: DidiTarget | null;
  downsideDidi: DidiTarget | null;
  screener: ScreenerResult;
}
