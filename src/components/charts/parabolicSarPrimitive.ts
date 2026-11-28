import type {
  AutoscaleInfo,
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Logical,
  SeriesAttachedParameter,
  SeriesPrimitivePaneViewZOrder,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type {
  ATSBaseline,
  OHLCVBar,
  ParabolicSARPoint,
  TimeframeSetup1234,
} from '@/types/ats';

interface ScreenOHLCBar {
  x: number;
  openY: number;
  highY: number;
  lowY: number;
  closeY: number;
  tickWidth: number;
}

interface ScreenSARPoint {
  x: number;
  y: number;
  isBullish: boolean;
}

interface ScreenOriginMarker {
  x: number;
  tag: string;
}

interface ScreenHorizontalRay {
  xStart: number;
  hasVisibleOrigin: boolean;
  y: number;
  color: string;
  lineWidth: number;
  dash: number[];
}

interface ScreenSetupOverlay {
  signalX: number | null;
  signalY: number | null;
  status: 'CONFIRMED' | 'CANDIDATE';
  stepNumber: 1 | 2 | 3 | 4;
  isBull: boolean;
  targetX: number;
  bille1Y: number | null; // SMA 7
  bille2Y: number | null; // SMA 20
}

type CanvasTarget = {
  useMediaCoordinateSpace: <T>(
    cb: (scope: {
      context: CanvasRenderingContext2D;
      mediaSize: { width: number; height: number };
    }) => T
  ) => T;
};

class ParabolicSARPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private bars: ScreenOHLCBar[];
  private points: ScreenSARPoint[];
  private origins: ScreenOriginMarker[];
  private rays: ScreenHorizontalRay[];
  private setupOverlay: ScreenSetupOverlay | null;

  constructor(
    bars: ScreenOHLCBar[],
    points: ScreenSARPoint[],
    origins: ScreenOriginMarker[],
    rays: ScreenHorizontalRay[],
    setupOverlay: ScreenSetupOverlay | null
  ) {
    this.bars = bars;
    this.points = points;
    this.origins = origins;
    this.rays = rays;
    this.setupOverlay = setupOverlay;
  }

  /**
   * Draws vertical grey dashed lines at Jack (t-20) and Oggy (t-7) origins
   * behind the OHLC bars, matching the TradingView AT.S visual reference.
   */
  drawBackground(target: CanvasTarget): void {
    if (this.origins.length === 0) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.strokeStyle = '#64748b';
      context.lineWidth = 1;
      context.setLineDash([4, 4]);

      for (const origin of this.origins) {
        const crispX = Math.round(origin.x) + 0.5;
        context.beginPath();
        context.moveTo(crispX, 0);
        context.lineTo(crispX, mediaSize.height);
        context.stroke();
      }

      context.setLineDash([]);
      context.font = '600 9px ui-monospace, SFMono-Regular, monospace';
      context.fillStyle = '#64748b';
      for (const origin of this.origins) {
        context.fillText(origin.tag, origin.x + 3, 10);
      }

      context.restore();
    });
  }

  draw(target: CanvasTarget): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();

      // 1. Draw Active Unpierced Jack & Oggy Horizontal Rays starting from Origin Bar -> Right Edge
      for (const ray of this.rays) {
        context.save();
        context.strokeStyle = ray.color;
        context.lineWidth = ray.lineWidth;
        context.setLineDash(ray.dash);
        context.beginPath();
        context.moveTo(ray.xStart, ray.y);
        context.lineTo(mediaSize.width, ray.y);
        context.stroke();
        context.restore();

        if (ray.hasVisibleOrigin) {
          context.beginPath();
          context.arc(ray.xStart, ray.y, 2.0, 0, Math.PI * 2);
          context.fillStyle = ray.color;
          context.fill();
        }
      }

      // 1b. Draw Crisp Medium-Thin Black OHLC Price Bars (lineWidth: 1.35px media space)
      if (this.bars.length > 0) {
        context.save();
        context.strokeStyle = '#000000';
        context.lineWidth = 1.35;
        context.lineCap = 'butt';
        context.beginPath();
        for (const bar of this.bars) {
          const x = Math.round(bar.x) + 0.5;
          context.moveTo(x, bar.highY);
          context.lineTo(x, bar.lowY);
          context.moveTo(x - bar.tickWidth, bar.openY);
          context.lineTo(x, bar.openY);
          context.moveTo(x, bar.closeY);
          context.lineTo(x + bar.tickWidth, bar.closeY);
        }
        context.stroke();
        context.restore();
      }

      // 2. Draw "SAR Wilder AT.S" circles (tmpSAR[1], green if tendance[1]==1 else red)
      for (const pt of this.points) {
        context.beginPath();
        context.arc(pt.x, pt.y, 2.9, 0, Math.PI * 2);
        context.fillStyle = pt.isBullish ? '#16a34a' : '#dc2626';
        context.fill();
      }

      // 3. Draw Setup 1-2-3-4 Overlay (Signal Orange / Vert + 2 billes noires SMA7 & SMA20)
      if (this.setupOverlay) {
        const ov = this.setupOverlay;

        const drawBlackBall = (y: number, tag: string) => {
          context.beginPath();
          context.arc(ov.targetX, y, 5.2, 0, Math.PI * 2);
          context.fillStyle = '#000000';
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = '#ffffff';
          context.stroke();

          context.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
          context.fillStyle = '#0f172a';
          context.fillText(tag, ov.targetX + 7, y + 3);
        };

        if (ov.bille1Y !== null) {
          drawBlackBall(ov.bille1Y, 'M7');
        }
        if (ov.bille2Y !== null) {
          drawBlackBall(ov.bille2Y, 'M20');
        }

        if (ov.signalX !== null && ov.signalY !== null) {
          const badgeColor =
            ov.stepNumber === 1
              ? '#f97316' // Orange: Step 1 (Wall / Candidate)
              : ov.isBull
              ? '#16a34a' // Green: Buy Step 2, 3, or 4
              : '#dc2626'; // Red: Sell Step 2, 3, or 4

          const yOffset = ov.isBull ? 16 : -16;
          const cy = Math.max(
            11,
            Math.min(mediaSize.height - 11, ov.signalY + yOffset)
          );

          context.beginPath();
          context.arc(ov.signalX, cy, 8.5, 0, Math.PI * 2);
          context.fillStyle = badgeColor;
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = '#ffffff';
          context.stroke();

          context.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
          context.fillStyle = '#ffffff';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(String(ov.stepNumber), ov.signalX, cy + 0.5);
          context.textAlign = 'start';
          context.textBaseline = 'alphabetic';
        }
      }

      context.restore();
    });
  }
}

class ParabolicSARPaneView implements ISeriesPrimitivePaneView {
  private source: ParabolicSARDotsPrimitive;
  private screenBars: ScreenOHLCBar[] = [];
  private screenPoints: ScreenSARPoint[] = [];
  private screenOrigins: ScreenOriginMarker[] = [];
  private screenRays: ScreenHorizontalRay[] = [];
  private screenOverlay: ScreenSetupOverlay | null = null;

  constructor(source: ParabolicSARDotsPrimitive) {
    this.source = source;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'normal';
  }

  update(): void {
    const chart = this.source.getChart();
    const series = this.source.getSeries();
    const data = this.source.getData();
    const setup = this.source.getSetup1234();

    if (!chart || !series) {
      this.screenBars = [];
      this.screenPoints = [];
      this.screenOrigins = [];
      this.screenRays = [];
      this.screenOverlay = null;
      return;
    }

    const timeScale = chart.timeScale();
    const chartWidth = timeScale.width();

    // 0. Project Medium-Thin OHLC Price Bars (lineWidth: 1.35px)
    const rawBars = this.source.getBars();
    const nextBars: ScreenOHLCBar[] = [];
    if (rawBars.length > 0) {
      let barSpacing = 10;
      if (rawBars.length >= 2) {
        const x1 = timeScale.timeToCoordinate(
          rawBars[rawBars.length - 1].time as Time
        );
        const x0 = timeScale.timeToCoordinate(
          rawBars[rawBars.length - 2].time as Time
        );
        if (x1 !== null && x0 !== null && x1 > x0) {
          barSpacing = x1 - x0;
        }
      }
      const tickWidth = Math.max(2.5, Math.min(5.5, barSpacing * 0.36));

      for (let i = 0; i < rawBars.length; i++) {
        const b = rawBars[i];
        const x = timeScale.timeToCoordinate(b.time as Time);
        if (x === null || (chartWidth > 0 && (x < -12 || x > chartWidth + 12))) {
          continue;
        }
        const openY = series.priceToCoordinate(b.open);
        const highY = series.priceToCoordinate(b.high);
        const lowY = series.priceToCoordinate(b.low);
        const closeY = series.priceToCoordinate(b.close);
        if (
          openY !== null &&
          highY !== null &&
          lowY !== null &&
          closeY !== null
        ) {
          nextBars.push({ x, openY, highY, lowY, closeY, tickWidth });
        }
      }
    }
    this.screenBars = nextBars;

    // 1. Project Vertical Grey Dashed Origin Lines (Jack t-20 & Oggy t-7)
    const nextOrigins: ScreenOriginMarker[] = [];
    for (const orig of this.source.getOriginTimes()) {
      const x = timeScale.timeToCoordinate(orig.time as Time);
      if (x !== null && (chartWidth === 0 || (x >= -4 && x <= chartWidth + 4))) {
        nextOrigins.push({ x, tag: orig.tag });
      }
    }
    this.screenOrigins = nextOrigins;

    // 2. Project Active Unpierced Jack & Oggy Horizontal Rays from Origin Bar -> Right Edge
    const nextRays: ScreenHorizontalRay[] = [];
    for (const line of this.source.getActiveBaselines()) {
      const y = series.priceToCoordinate(line.price);
      if (y === null) continue;

      const xRaw = timeScale.timeToCoordinate(line.referenceTime as Time);
      const xStart = xRaw !== null ? Math.max(0, xRaw) : 0;
      const hasVisibleOrigin = xRaw !== null && xRaw >= 0;

      const isZero = line.key === 'Jack_0' || line.key === 'Oggy_0';
      const dash = isZero
        ? []
        : line.family === 'Jack'
        ? [6, 4]
        : [2, 3];

      // Oggy lines MUST be rendered in BLUE; Jack lines retain Green/Red polarity; all lines thin (lineWidth: 1)
      const rayColor =
        line.family === 'Oggy'
          ? '#2563eb'
          : line.polarity === 'GREEN'
          ? '#16a34a'
          : '#dc2626';

      nextRays.push({
        xStart,
        hasVisibleOrigin,
        y,
        color: rayColor,
        lineWidth: 1,
        dash,
      });
    }
    this.screenRays = nextRays;

    // 3. Project Wilder SAR dots
    if (this.source.isVisible() && data.length > 0) {
      const nextPoints: ScreenSARPoint[] = [];
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        if (!pt) continue;
        const x = timeScale.timeToCoordinate(pt.time as Time);
        if (x === null || (chartWidth > 0 && (x < -12 || x > chartWidth + 12))) {
          continue;
        }
        const y = series.priceToCoordinate(pt.value);
        if (y !== null) {
          nextPoints.push({ x, y, isBullish: pt.isBullish });
        }
      }
      this.screenPoints = nextPoints;
    } else {
      this.screenPoints = [];
    }

    // 4. Project Setup 1-2-3-4 markers & "2 billes noires" (SMA7 / SMA20)
    const lastBarTime = this.source.getLatestBarTime();
    if (
      this.source.isSetupVisible() &&
      setup &&
      setup.status !== 'NONE' &&
      lastBarTime
    ) {
      const lastX = timeScale.timeToCoordinate(lastBarTime as Time);
      let barSpacing = 10;
      if (data.length >= 2) {
        const prevX = timeScale.timeToCoordinate(
          data[data.length - 2].time as Time
        );
        if (lastX !== null && prevX !== null && lastX > prevX) {
          barSpacing = lastX - prevX;
        }
      }

      const targetX =
        (lastX ?? chartWidth - 36) + Math.max(12, barSpacing * 1.8);

      const sigX = setup.signalBarTime
        ? timeScale.timeToCoordinate(setup.signalBarTime as Time)
        : null;
      const sigY =
        setup.signalPriceLevel !== null
          ? series.priceToCoordinate(setup.signalPriceLevel)
          : null;

      const bille1Y =
        !setup.tp1Hit && setup.tp1Sma7 !== null
          ? series.priceToCoordinate(setup.tp1Sma7)
          : null;
      const bille2Y =
        !setup.tp2Hit && setup.tp2Sma20 !== null
          ? series.priceToCoordinate(setup.tp2Sma20)
          : null;

      const resolvedStep: 1 | 2 | 3 | 4 =
        setup.stepNumber ??
        (setup.status === 'CANDIDATE'
          ? 1
          : setup.tp2Hit
          ? 4
          : setup.tp1Hit
          ? 3
          : 2);

      this.screenOverlay = {
        signalX: sigX,
        signalY: sigY,
        status: setup.status,
        stepNumber: resolvedStep,
        isBull: setup.isBull,
        targetX,
        bille1Y,
        bille2Y,
      };
    } else {
      this.screenOverlay = null;
    }
  }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    if (
      this.screenBars.length === 0 &&
      this.screenPoints.length === 0 &&
      this.screenOrigins.length === 0 &&
      this.screenRays.length === 0 &&
      !this.screenOverlay
    ) {
      return null;
    }
    return new ParabolicSARPaneRenderer(
      this.screenBars,
      this.screenPoints,
      this.screenOrigins,
      this.screenRays,
      this.screenOverlay
    );
  }
}

export class ParabolicSARDotsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private bars: OHLCVBar[] = [];
  private data: ParabolicSARPoint[] = [];
  private visible = true;
  private originTimes: Array<{ time: string; tag: string }> = [];
  private activeBaselines: ATSBaseline[] = [];
  private setup1234: TimeframeSetup1234 | null = null;
  private latestBarTime: string | null = null;
  private showSetupOverlay = true;
  private paneView: ParabolicSARPaneView;
  private paneViewsArray: readonly ISeriesPrimitivePaneView[];

  constructor() {
    this.paneView = new ParabolicSARPaneView(this);
    this.paneViewsArray = [this.paneView];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(params: {
    bars: OHLCVBar[];
    sarPoints: ParabolicSARPoint[];
    showSAR: boolean;
    originTimes: Array<{ time: string; tag: string }>;
    activeBaselines: ATSBaseline[];
    setup1234: TimeframeSetup1234 | null;
    latestBarTime: string | null;
    showSetupOverlay: boolean;
  }): void {
    this.bars = params.bars;
    this.data = params.sarPoints;
    this.visible = params.showSAR;
    this.originTimes = params.originTimes;
    this.activeBaselines = params.activeBaselines;
    this.setup1234 = params.setup1234;
    this.latestBarTime = params.latestBarTime;
    this.showSetupOverlay = params.showSetupOverlay;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.paneView.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this.paneViewsArray;
  }

  autoscaleInfo(
    startTimePoint: Logical,
    endTimePoint: Logical
  ): AutoscaleInfo | null {
    let minVal = Infinity;
    let maxVal = -Infinity;

    if (this.visible && this.data.length > 0) {
      const from = Math.max(0, Math.floor(startTimePoint));
      const to = Math.min(this.data.length - 1, Math.ceil(endTimePoint));
      for (let i = from; i <= to; i++) {
        const v = this.data[i]?.value;
        if (v !== undefined && Number.isFinite(v)) {
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      }
    }

    for (const line of this.activeBaselines) {
      minVal = Math.min(minVal, line.price);
      maxVal = Math.max(maxVal, line.price);
    }

    if (
      this.showSetupOverlay &&
      this.setup1234 &&
      this.setup1234.status !== 'NONE'
    ) {
      if (this.setup1234.tp1Sma7 !== null) {
        minVal = Math.min(minVal, this.setup1234.tp1Sma7);
        maxVal = Math.max(maxVal, this.setup1234.tp1Sma7);
      }
      if (this.setup1234.tp2Sma20 !== null) {
        minVal = Math.min(minVal, this.setup1234.tp2Sma20);
        maxVal = Math.max(maxVal, this.setup1234.tp2Sma20);
      }
    }

    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return null;

    return {
      priceRange: {
        minValue: minVal,
        maxValue: maxVal,
      },
    };
  }

  getChart(): IChartApiBase<Time> | null {
    return this.chart;
  }

  getSeries(): ISeriesApi<SeriesType, Time> | null {
    return this.series;
  }

  getBars(): OHLCVBar[] {
    return this.bars;
  }

  getData(): ParabolicSARPoint[] {
    return this.data;
  }

  getOriginTimes(): Array<{ time: string; tag: string }> {
    return this.originTimes;
  }

  getActiveBaselines(): ATSBaseline[] {
    return this.activeBaselines;
  }

  getSetup1234(): TimeframeSetup1234 | null {
    return this.setup1234;
  }

  getLatestBarTime(): string | null {
    return this.latestBarTime;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isSetupVisible(): boolean {
    return this.showSetupOverlay;
  }
}
