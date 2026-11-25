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

/**
 * 6-Pane Chart Grid Order:
 * Top row:    Jour (D)  -> Semaine (W)   -> Mois (M)
 * Bottom row: Année (12M) -> Semestre (6M) -> Trimestre (3M)
 */
export const CHART_GRID_TIMEFRAMES: readonly Timeframe[] = [
  'D',
  'W',
  'M',
  '12M',
  '6M',
  '3M',
] as const;

export const HIGHER_TIMEFRAMES: readonly Timeframe[] = [
  'W',
  'M',
  '3M',
  '6M',
  '12M',
] as const;

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  D: 'Jour (1D)',
  W: 'Semaine (1W)',
  M: 'Mois (1M)',
  '3M': 'Trimestre (3M)',
  '6M': 'Semestre (6M)',
  '12M': 'Année (12M)',
};

export type ATSPolarity = 'GREEN' | 'RED';
export type SetupDirection = 'LONG' | 'SHORT' | 'NEUTRAL';
export type SetupConfirmationStatus = 'CONFIRMED' | 'CANDIDATE' | 'WATCH';

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
  /** True if price pierced decisively beyond the AT.S "Autour" tolerance (no longer active) */
  isPierced: boolean;
  /** Elastic AT.S "Autour" classification around the baseline */
  autourZone: 'EXACT' | 'APPROACH' | 'OVERSHOOT_AUTOUR' | 'DISTANT' | 'PIERCED';
  /** Continuous 0..1 quality weight in the AT.S "Autour" model */
  autourWeight: number;
  /** True if unpierced AND price is within visual approach range on this timeframe */
  shouldPlotOnChart: boolean;
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

export interface MovingAveragePoint {
  time: string;
  value: number;
  /** True when current Price >= MA or MA is rising (AT.S green vs red polarity) */
  isGreen: boolean;
}

export interface BollingerBandPoint {
  time: string;
  upper: number;
  mid: number;
  lower: number;
  stdDev: number;
  bandwidth: number;
  upperGreen: boolean;
  midGreen: boolean;
  lowerGreen: boolean;
}

export interface ParabolicSARPoint {
  time: string;
  /** Plotted tmpSAR[1] per AT.S Wilder specification */
  value: number;
  /** tendance[1] == 1 => true (green), else false (red) */
  isBullish: boolean;
  /** true when SAR switched polarity on this bar */
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
    | 'HTF_BB_Lower'
    | 'SMA7'
    | 'SMA20';
  /** Absolute move % toward target from livePrice */
  upsidePct: number;
}

export interface TimeframeSetup1234 {
  status: 'CONFIRMED' | 'CANDIDATE' | 'NONE';
  isBull: boolean;
  signalBarTime: string | null;
  signalPriceLevel: number | null;
  confluenceText: string;
  /** Objective 1: SMA 7 (first black target dot / bille noire) */
  tp1Sma7: number | null;
  /** Objective 2: SMA 20 (second black target dot / bille noire) */
  tp2Sma20: number | null;
  tp1Hit: boolean;
  tp2Hit: boolean;
}

export interface TimeframeATSData {
  timeframe: Timeframe;
  bars: OHLCVBar[];
  Jack: JackMatrix;
  Oggy: OggyMatrix;
  sma7: MovingAveragePoint[];
  sma20: MovingAveragePoint[];
  latestSMA7: MovingAveragePoint | null;
  latestSMA20: MovingAveragePoint | null;
  bollingerBands: BollingerBandPoint[];
  latestBB: BollingerBandPoint | null;
  /** Step 3 check: whether the opposite Bollinger Band has started curving inwards */
  oppositeBandCurvingInwards: boolean;
  /** Overall Bollinger bandwidth contraction on latest bar */
  bbCompressing: boolean;
  parabolicSAR: ParabolicSARPoint[];
  latestSAR: ParabolicSARPoint | null;
  sarFlippedBullishRecently: boolean;
  sarFlippedBearishRecently: boolean;
  Didi: DidiTarget | null;
  setup1234: TimeframeSetup1234;
}

export interface MacroTargetTP2 {
  price: number;
  label: string;
  timeframe: Timeframe;
  upsidePct: number;
}

export interface TimeframeHorizonSummary {
  timeframe: Timeframe;
  /** Count of UNPIERCED Green Support baselines */
  greenCount: number;
  /** Count of UNPIERCED Red Resistance baselines */
  redCount: number;
  piercedCount: number;
  greenLines: string[];
  redLines: string[];
  wallTouches: Array<{
    shortName: string;
    label: string;
    polarity: ATSPolarity;
    price: number;
    absDistancePct: number;
  }>;
  bbState: 'CURVING_IN' | 'COMPRESSING' | 'EXPANDING' | 'NA';
  sarState: 'BULL_FLIP' | 'BEAR_FLIP' | 'BULL' | 'BEAR' | 'NA';
  m7Price: number | null;
  m20Price: number | null;
}

export interface ScreenerResult {
  symbol: string;
  displaySymbol: string;
  name?: string;
  category: AssetCategory;
  livePrice: number;
  change24hPct: number;
  direction: SetupDirection;
  /** CONFIRMED = Signal Vert/Rouge (opposite BB turned), CANDIDATE = Signal Orange, WATCH = off-wall */
  signalStatus: SetupConfirmationStatus;
  isAtWall: boolean;
  isAtSupportWall: boolean;
  isAtResistanceWall: boolean;
  activeWallLabel: string;
  wallPrice: number | null;
  wallProximityPct: number | null;
  confluentWallLines: ATSBaseline[];
  confluentResistanceLines: ATSBaseline[];
  nearestGreenSupport: ATSBaseline | null;
  nearestRedResistance: ATSBaseline | null;
  confidenceScore: number;
  setupStep: 0 | 1 | 2 | 3 | 4;
  stepFlags: {
    step1Wall: boolean;
    step2Didi: boolean;
    step3VolatilityReversal: boolean;
    step4MacroM20: boolean;
  };
  volatilitySignal: string;
  stopLoss: number;
  riskPct: number;
  Didi: DidiTarget | null;
  downsideDidi: DidiTarget | null;
  effectiveTargetTP1: DidiTarget | null;
  macroTargetTP2: MacroTargetTP2 | null;
  riskRewardRatio: number | null;
  horizonMatrix: Record<Timeframe, TimeframeHorizonSummary>;
  thesisHeadline: string;
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
