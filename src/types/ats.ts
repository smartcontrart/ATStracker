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

/**
 * Chronological ATS State Detection Engine statuses (Setup 1-2-3-4):
 * - STEP 2: REVERSAL CONFIRMED (Conservative — opposite Daily BB hooked inward on cluster)
 * - STEP 1: THE WALL (Aggressive — sniper entry on cluster while Daily BB still widening in Phase 2)
 * - NO SETUP (Failed Volatility Gatekeeper checks 1, 2, or 3)
 * - INVALIDATED (Knockout Rule — livePrice breached established Didi by > 1%)
 */
export type AtsState =
  | 'INVALIDATED'
  | 'NO SETUP'
  | 'STEP 1: THE WALL'
  | 'STEP 2: REVERSAL CONFIRMED';

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
  /** GREEN = Support (price <= livePrice), RED = Resistance (price >= livePrice) */
  polarity: ATSPolarity;
  /** True if pierced/broken by livePrice (excluded from UI and calculations) */
  isPierced: boolean;
  autourZone: 'EXACT' | 'APPROACH' | 'OVERSHOOT_AUTOUR' | 'DISTANT' | 'PIERCED';
  autourWeight: number;
  /** True ONLY if unpierced AND within visual proximity range on this timeframe */
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
  upsidePct: number;
}

export interface TimeframeSetup1234 {
  status: 'CONFIRMED' | 'CANDIDATE' | 'NONE';
  isBull: boolean;
  signalBarTime: string | null;
  signalPriceLevel: number | null;
  confluenceText: string;
  tp1Sma7: number | null;
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
  oppositeBandCurvingInwards: boolean;
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
  /** Count of UNBROKEN Green Support baselines */
  greenCount: number;
  /** Count of UNBROKEN Red Resistance baselines */
  redCount: number;
  /** Count of UNBROKEN Oggy baselines (rendered in Blue) */
  oggyCount: number;
  piercedCount: number;
  greenLines: string[];
  redLines: string[];
  wallTouches: Array<{
    shortName: string;
    label: string;
    family: 'Jack' | 'Oggy';
    polarity: ATSPolarity;
    price: number;
    absDistancePct: number;
  }>;
  bbState: 'CURVING_IN' | 'COMPRESSING' | 'EXPANDING' | 'NA';
  sarState: 'BULL_FLIP' | 'BEAR_FLIP' | 'BULL' | 'BEAR' | 'NA';
  m7Price: number | null;
  m20Price: number | null;
}

export type HTFLevelKind = 'SAR' | 'MM7' | 'MM20' | 'Jack' | 'Oggy';

export interface MatchedHTFLevel {
  label: string;
  timeframe: Timeframe;
  kind: HTFLevelKind;
  price: number;
  distancePct: number;
}

export interface AtsStateDetectionResult {
  state: AtsState;
  setupSide: 'BUY' | 'SELL' | 'NONE';
  /** Trigger timeframe where price exits the Bollinger Band (6M > 3M > M > W > D) */
  bbExitTimeframe: Timeframe | null;
  /** Highest timeframe of the matched support/resistance (strictly > bbExitTimeframe) */
  highestHtfTimeframe: Timeframe | null;
  /** Deterministic hierarchy rank: higher trigger TF & higher S/R TF always rank first */
  setupHierarchyRank: number;
  /** All matched HTF levels (SAR, MM7, MM20, Jack, Oggy) on timeframes > bbExitTimeframe */
  matchedHtfLevels: MatchedHTFLevel[];
  ClusterDensityCount: number;
  RiskToDidiPercentage: number;
  RiskToDidi: number;
  didiPrice: number;
  clusterLines: ATSBaseline[];
  gatekeeperChecks: {
    didNotKnockout: boolean;
    check1Phase2Diverging: boolean;
    check2OuterBandPush: boolean;
    check3OnHtfCluster: boolean;
    check4Phase3HookedInward: boolean;
  };
}

export interface ScreenerResult {
  symbol: string;
  displaySymbol: string;
  name?: string;
  category: AssetCategory;
  livePrice: number;
  change24hPct: number;
  /** Resulting chronological ATS State */
  atsState: AtsState;
  setupSide: 'BUY' | 'SELL' | 'NONE';
  /** Timeframe where price gets out of the Bollinger Band (higher = better) */
  bbExitTimeframe: Timeframe | null;
  /** Highest timeframe of the matched Support/Resistance (> bbExitTimeframe) */
  highestHtfTimeframe: Timeframe | null;
  /** Hierarchy rank: higher BB-exit TF + higher S/R TF always sorts at the top */
  setupHierarchyRank: number;
  /** Matched HTF Supports/Resistances (SAR, MM7, MM20, Jack, Oggy) */
  matchedHtfLevels: MatchedHTFLevel[];
  direction: SetupDirection;
  signalStatus: SetupConfirmationStatus;
  /** Number of unbroken HTF Jack/Oggy lines sitting within 1% of livePrice */
  ClusterDensityCount: number;
  /** Percentage distance between livePrice and the Didi stop-loss */
  RiskToDidi: number;
  RiskToDidiPercentage: number;
  /** Didi extreme stop-loss price reached during the Phase 2 BB expansion */
  didiPrice: number;
  gatekeeperChecks: AtsStateDetectionResult['gatekeeperChecks'];
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
