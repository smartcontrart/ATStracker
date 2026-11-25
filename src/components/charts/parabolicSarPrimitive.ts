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
import type { ParabolicSARPoint, TimeframeSetup1234 } from '@/types/ats';

interface ScreenSARPoint {
  x: number;
  y: number;
  isBullish: boolean;
}

interface ScreenSetupOverlay {
  signalX: number | null;
  signalY: number | null;
  status: 'CONFIRMED' | 'CANDIDATE';
  isBull: boolean;
  targetX: number;
  bille1Y: number | null; // SMA 7
  bille2Y: number | null; // SMA 20
}

class ParabolicSARPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private points: ScreenSARPoint[];
  private setupOverlay: ScreenSetupOverlay | null;

  constructor(
    points: ScreenSARPoint[],
    setupOverlay: ScreenSetupOverlay | null
  ) {
    this.points = points;
    this.setupOverlay = setupOverlay;
  }

  draw(target: {
    useMediaCoordinateSpace: <T>(
      cb: (scope: { context: CanvasRenderingContext2D }) => T
    ) => T;
  }): void {
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();

      // 1. Draw "SAR Wilder AT.S" circles (tmpSAR[1], green if tendance[1]==1 else red)
      for (const pt of this.points) {
        context.beginPath();
        context.arc(pt.x, pt.y, 2.9, 0, Math.PI * 2);
        context.fillStyle = pt.isBullish ? '#16a34a' : '#dc2626';
        context.fill();
      }

      // 2. Draw Setup 1-2-3-4 Overlay (Signal Orange / Vert + 2 billes noires SMA7 & SMA20)
      if (this.setupOverlay) {
        const ov = this.setupOverlay;

        // 2a. "2 billes noires" (Black target circles at SMA7 & SMA20 at bar_index + 2)
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

        // 2b. Signal Marker (Orange = Candidat non confirmé, Vert/Rouge = Confirmé)
        if (ov.signalX !== null && ov.signalY !== null) {
          const badgeColor =
            ov.status === 'CONFIRMED'
              ? ov.isBull
                ? '#16a34a'
                : '#dc2626'
              : '#f97316'; // Orange candidate per setup1234.pine

          const yOffset = ov.isBull ? 14 : -14;
          const cy = ov.signalY + yOffset;

          context.beginPath();
          context.arc(ov.signalX, cy, 5.5, 0, Math.PI * 2);
          context.fillStyle = badgeColor;
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = '#ffffff';
          context.stroke();
        }
      }

      context.restore();
    });
  }
}

class ParabolicSARPaneView implements ISeriesPrimitivePaneView {
  private source: ParabolicSARDotsPrimitive;
  private screenPoints: ScreenSARPoint[] = [];
  private screenOverlay: ScreenSetupOverlay | null = null;

  constructor(source: ParabolicSARDotsPrimitive) {
    this.source = source;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'top';
  }

  update(): void {
    const chart = this.source.getChart();
    const series = this.source.getSeries();
    const data = this.source.getData();
    const setup = this.source.getSetup1234();

    if (!chart || !series) {
      this.screenPoints = [];
      this.screenOverlay = null;
      return;
    }

    const timeScale = chart.timeScale();
    const chartWidth = timeScale.width();

    // 1. Project Wilder SAR dots
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

    // 2. Project Setup 1-2-3-4 markers & "2 billes noires" (SMA7 / SMA20)
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

      const targetX = (lastX ?? chartWidth - 36) + Math.max(12, barSpacing * 1.8);

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

      this.screenOverlay = {
        signalX: sigX,
        signalY: sigY,
        status: setup.status,
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
    if (this.screenPoints.length === 0 && !this.screenOverlay) {
      return null;
    }
    return new ParabolicSARPaneRenderer(this.screenPoints, this.screenOverlay);
  }
}

/**
 * Custom Canvas Series Primitive rendering:
 * 1. "SAR Wilder AT.S" circles (tmpSAR[1], green / red)
 * 2. Setup 1-2-3-4 Signal (Orange Candidat / Vert-Rouge Confirmé) + "2 billes noires" (SMA7 & SMA20)
 */
export class ParabolicSARDotsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private data: ParabolicSARPoint[] = [];
  private visible = true;
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

  setData(
    data: ParabolicSARPoint[],
    visible = true,
    setup1234: TimeframeSetup1234 | null = null,
    latestBarTime: string | null = null,
    showSetupOverlay = true
  ): void {
    this.data = data;
    this.visible = visible;
    this.setup1234 = setup1234;
    this.latestBarTime = latestBarTime;
    this.showSetupOverlay = showSetupOverlay;
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
    if (!this.visible || this.data.length === 0) return null;

    const from = Math.max(0, Math.floor(startTimePoint));
    const to = Math.min(this.data.length - 1, Math.ceil(endTimePoint));
    if (from > to) return null;

    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let i = from; i <= to; i++) {
      const v = this.data[i]?.value;
      if (v !== undefined && Number.isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }

    if (this.showSetupOverlay && this.setup1234 && this.setup1234.status !== 'NONE') {
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

  getData(): ParabolicSARPoint[] {
    return this.data;
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
