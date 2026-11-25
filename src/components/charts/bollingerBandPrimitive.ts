import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesPrimitivePaneViewZOrder,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { BollingerBandPoint } from '@/types/ats';

interface ScreenBandPoint {
  x: number;
  upperY: number;
  lowerY: number;
}

class BollingerBandPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private points: ScreenBandPoint[] = [];
  private fillColor: string;

  constructor(points: ScreenBandPoint[], fillColor: string) {
    this.points = points;
    this.fillColor = fillColor;
  }

  draw(target: {
    useMediaCoordinateSpace: <T>(
      cb: (scope: { context: CanvasRenderingContext2D }) => T
    ) => T;
  }): void {
    if (this.points.length < 2) return;

    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.beginPath();

      const first = this.points[0];
      context.moveTo(first.x, first.upperY);

      for (let i = 1; i < this.points.length; i++) {
        context.lineTo(this.points[i].x, this.points[i].upperY);
      }

      for (let i = this.points.length - 1; i >= 0; i--) {
        context.lineTo(this.points[i].x, this.points[i].lowerY);
      }

      context.closePath();
      context.fillStyle = this.fillColor;
      context.fill();
      context.restore();
    });
  }
}

class BollingerBandPaneView implements ISeriesPrimitivePaneView {
  private source: BollingerBandCloudPrimitive;
  private screenPoints: ScreenBandPoint[] = [];

  constructor(source: BollingerBandCloudPrimitive) {
    this.source = source;
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return 'bottom';
  }

  update(): void {
    const chart = this.source.getChart();
    const series = this.source.getSeries();
    const data = this.source.getData();

    if (!chart || !series || data.length < 2) {
      this.screenPoints = [];
      return;
    }

    const timeScale = chart.timeScale();
    const nextPoints: ScreenBandPoint[] = [];

    for (const pt of data) {
      const x = timeScale.timeToCoordinate(pt.time as Time);
      const upperY = series.priceToCoordinate(pt.upper);
      const lowerY = series.priceToCoordinate(pt.lower);

      if (x !== null && upperY !== null && lowerY !== null) {
        nextPoints.push({ x, upperY, lowerY });
      }
    }

    this.screenPoints = nextPoints;
  }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    if (!this.source.isVisible() || this.screenPoints.length < 2) {
      return null;
    }
    return new BollingerBandPaneRenderer(
      this.screenPoints,
      this.source.getFillColor()
    );
  }
}

/**
 * Custom Lightweight Charts Series Primitive that renders a shaded Bollinger Band
 * cloud strictly bounded between Upper BB and Lower BB.
 */
export class BollingerBandCloudPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private data: BollingerBandPoint[] = [];
  private visible = true;
  private fillColor: string;
  private paneView: BollingerBandPaneView;
  private paneViewsArray: readonly ISeriesPrimitivePaneView[];

  constructor(fillColor = 'rgba(254, 249, 195, 0.72)') {
    this.fillColor = fillColor;
    this.paneView = new BollingerBandPaneView(this);
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

  setData(data: BollingerBandPoint[], visible = true): void {
    this.data = data;
    this.visible = visible;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    this.paneView.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this.paneViewsArray;
  }

  getChart(): IChartApiBase<Time> | null {
    return this.chart;
  }

  getSeries(): ISeriesApi<SeriesType, Time> | null {
    return this.series;
  }

  getData(): BollingerBandPoint[] {
    return this.data;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getFillColor(): string {
    return this.fillColor;
  }
}
