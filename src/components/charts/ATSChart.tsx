'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { BollingerBandCloudPrimitive } from '@/components/charts/bollingerBandPrimitive';
import type { CrosshairSyncBus } from '@/components/charts/crosshairSyncBus';
import { ParabolicSARDotsPrimitive } from '@/components/charts/parabolicSarPrimitive';
import { Badge } from '@/components/ui/badge';
import { flattenTimeframeBaselines } from '@/lib/atsIndicators';
import { findCorrespondingBarForDate } from '@/lib/dataResampler';
import { cn, formatPrice } from '@/lib/utils';
import type { ATSUIPreferences } from '@/store/useATSStore';
import {
  type AssetCategory,
  type ATSBaseline,
  type OHLCVBar,
  TIMEFRAME_LABELS,
  type TimeframeATSData,
} from '@/types/ats';

export interface ATSChartProps {
  data: TimeframeATSData;
  category: AssetCategory;
  livePrice: number;
  preferences: ATSUIPreferences;
  syncBus?: CrosshairSyncBus;
  isHighlightedWallTimeframe?: boolean;
  wallHighlightType?: 'SUPPORT' | 'RESISTANCE' | null;
  /** Screener-matched Jack/Oggy labels for this timeframe — always plotted if unbroken */
  matchedBaselineLabels?: string[];
  onExpand?: () => void;
  isExpanded?: boolean;
}

const JACK_SHORT_NAMES: Record<string, string> = {
  Jack_Minus1: 'Jack -1',
  Jack_0: 'Jack 0',
  Jack_Plus1: 'Jack +1',
};

const OGGY_SHORT_NAMES: Record<string, string> = {
  Oggy_Minus1: 'Oggy -1',
  Oggy_0: 'Oggy 0',
  Oggy_Plus1: 'Oggy +1',
};

export const ATSChart: React.FC<ATSChartProps> = ({
  data,
  category,
  livePrice,
  preferences,
  syncBus,
  isHighlightedWallTimeframe = false,
  wallHighlightType = null,
  matchedBaselineLabels,
  onExpand,
  isExpanded = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const barSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null);
  const bbUpperAreaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const sma20LineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma7LineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbCloudPrimitiveRef = useRef<BollingerBandCloudPrimitive | null>(null);
  const sarPrimitiveRef = useRef<ParabolicSARDotsPrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const isProgrammaticSyncRef = useRef(false);

  const latestBar =
    data.bars.length > 0 ? data.bars[data.bars.length - 1] : null;
  const [hudBar, setHudBar] = useState<OHLCVBar | null>(latestBar);

  useEffect(() => {
    setHudBar(data.bars.length > 0 ? data.bars[data.bars.length - 1] : null);
  }, [data.bars]);

  // 1. Initialize Light-Theme Chart with Black OHLC Bars, Yellow BB Cloud, M7/M20 & SAR Wilder AT.S
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pricePrecision =
      category === 'forex' ? 5 : livePrice < 1 ? 5 : livePrice < 10 ? 4 : 2;
    const minMove = Number((1 / Math.pow(10, pricePrecision)).toFixed(6));

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#334155',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#e5e7eb' },
        horzLines: { color: '#e5e7eb' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#64748b',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#0f172a',
        },
        horzLine: {
          color: '#64748b',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#0f172a',
        },
      },
      rightPriceScale: {
        borderColor: '#cbd5e1',
        scaleMargins: { top: 0.09, bottom: 0.09 },
      },
      timeScale: {
        borderColor: '#cbd5e1',
        timeVisible: false,
        rightOffset: 4,
      },
      handleScroll: true,
      handleScale: true,
    });

    // 1. Bollinger Band Upper + Warm Light-Yellow Bounded Cloud (thin lineWidth: 1)
    const bbUpperArea = chart.addAreaSeries({
      lineColor: '#16a34a',
      topColor: 'rgba(254, 249, 195, 0.0)',
      bottomColor: 'rgba(254, 249, 195, 0.0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: pricePrecision, minMove },
    });

    const bbCloud = new BollingerBandCloudPrimitive('rgba(254, 249, 195, 0.78)');
    bbUpperArea.attachPrimitive(bbCloud);

    // 2. M20 (SMA 20 / BB Mid) — Green or Red (thin lineWidth: 1)
    const sma20Line = chart.addLineSeries({
      color: '#16a34a',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: pricePrecision, minMove },
    });

    // 3. M7 (SMA 7) — Green or Red (thin lineWidth: 1)
    const sma7Line = chart.addLineSeries({
      color: '#16a34a',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: pricePrecision, minMove },
    });

    // 4. Bollinger Band Lower — Green or Red (thin lineWidth: 1)
    const bbLowerLine = chart.addLineSeries({
      color: '#16a34a',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: pricePrecision, minMove },
    });

    // 5. OHLC Bar Series (native handles autoscale/crosshair/Y-axis; canvas renders exact 1.35px black bars)
    const barSeries = chart.addBarSeries({
      upColor: 'rgba(0, 0, 0, 0)',
      downColor: 'rgba(0, 0, 0, 0)',
      openVisible: true,
      thinBars: true,
      priceFormat: { type: 'price', precision: pricePrecision, minMove },
    });

    // 6. SAR Wilder AT.S circles + Setup 1-2-3-4 ("2 billes noires" & Signal Orange/Vert)
    const sarPrimitive = new ParabolicSARDotsPrimitive();
    barSeries.attachPrimitive(sarPrimitive);

    chartRef.current = chart;
    barSeriesRef.current = barSeries;
    bbUpperAreaSeriesRef.current = bbUpperArea;
    sma20LineSeriesRef.current = sma20Line;
    sma7LineSeriesRef.current = sma7Line;
    bbLowerLineSeriesRef.current = bbLowerLine;
    bbCloudPrimitiveRef.current = bbCloud;
    sarPrimitiveRef.current = sarPrimitive;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      barSeriesRef.current = null;
    };
  }, [category]);

  // 2. Populate Black OHLC Bars, BB + M7/M20, SAR Wilder AT.S, and Unpierced Proximate Jack/Oggy
  const matchedLabelsKey = (matchedBaselineLabels ?? []).join('|');
  useEffect(() => {
    const chart = chartRef.current;
    const barSeries = barSeriesRef.current;
    const bbUpper = bbUpperAreaSeriesRef.current;
    const sma20Line = sma20LineSeriesRef.current;
    const sma7Line = sma7LineSeriesRef.current;
    const bbLower = bbLowerLineSeriesRef.current;
    const bbCloud = bbCloudPrimitiveRef.current;
    const sarPrimitive = sarPrimitiveRef.current;

    if (
      !chart ||
      !barSeries ||
      !bbUpper ||
      !sma20Line ||
      !sma7Line ||
      !bbLower
    ) {
      return;
    }

    // Black OHLC Bars
    barSeries.setData(
      data.bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    // Bollinger Bands + M20 + M7 colored Green (#16a34a) or Red (#dc2626).
    // NOTE: Lightweight Charts strokes segment (i -> i+1) using items[i]'s color,
    // so items[i] MUST carry the slope color of (i -> i+1) (stored on arr[i+1]).
    if (preferences.showBollinger && data.bollingerBands.length > 0) {
      bbUpper.setData(
        data.bollingerBands.map((pt, i, arr) => {
          const isGreenSeg = i + 1 < arr.length ? arr[i + 1].upperGreen : pt.upperGreen;
          return {
            time: pt.time as Time,
            value: pt.upper,
            lineColor: isGreenSeg ? '#16a34a' : '#dc2626',
          };
        })
      );
      sma20Line.setData(
        data.sma20.map((pt, i, arr) => {
          const isGreenSeg = i + 1 < arr.length ? arr[i + 1].isGreen : pt.isGreen;
          return {
            time: pt.time as Time,
            value: pt.value,
            color: isGreenSeg ? '#16a34a' : '#dc2626',
          };
        })
      );
      sma7Line.setData(
        data.sma7.map((pt, i, arr) => {
          const isGreenSeg = i + 1 < arr.length ? arr[i + 1].isGreen : pt.isGreen;
          return {
            time: pt.time as Time,
            value: pt.value,
            color: isGreenSeg ? '#16a34a' : '#dc2626',
          };
        })
      );
      bbLower.setData(
        data.bollingerBands.map((pt, i, arr) => {
          const isGreenSeg = i + 1 < arr.length ? arr[i + 1].lowerGreen : pt.lowerGreen;
          return {
            time: pt.time as Time,
            value: pt.lower,
            color: isGreenSeg ? '#16a34a' : '#dc2626',
          };
        })
      );
      bbCloud?.setData(data.bollingerBands, true);
    } else {
      bbUpper.setData([]);
      sma20Line.setData([]);
      sma7Line.setData([]);
      bbLower.setData([]);
      bbCloud?.setData([], false);
    }

    // Clear previous Jack/Oggy Y-axis price labels
    for (const pl of priceLinesRef.current) {
      try {
        barSeries.removePriceLine(pl);
      } catch {
        // Ignore stale line
      }
    }
    priceLinesRef.current = [];

    // Vertical grey dashed origin markers at Jack (t-20) and Oggy (t-7)
    const originTimes: Array<{ time: string; tag: string }> = [];
    if (preferences.showJack && data.bars.length > 20) {
      originTimes.push({
        time: data.bars[data.bars.length - 1 - 20].time,
        tag: 'J-20',
      });
    }
    if (preferences.showOggy && data.bars.length > 7) {
      originTimes.push({
        time: data.bars[data.bars.length - 1 - 7].time,
        tag: 'O-7',
      });
    }

    // Active UNBROKEN proximate (or screener-matched) Jack (Green/Red) & Oggy (BLUE) horizontal rays
    const activeBaselines: ATSBaseline[] = [];
    const matchedLabelSet = new Set(
      matchedLabelsKey ? matchedLabelsKey.split('|') : []
    );
    const isBrokenByLivePrice = (line: ATSBaseline) =>
      line.isPierced ||
      (line.polarity === 'GREEN' && line.price > livePrice) ||
      (line.polarity === 'RED' && line.price < livePrice);

    if (preferences.showJack) {
      const jackEntries = [
        data.Jack.Jack_Minus1,
        data.Jack.Jack_0,
        data.Jack.Jack_Plus1,
      ];
      for (const line of jackEntries) {
        if (
          !line ||
          (!line.shouldPlotOnChart && !matchedLabelSet.has(line.label)) ||
          isBrokenByLivePrice(line)
        ) {
          continue;
        }
        activeBaselines.push(line);
        const jackColor = line.polarity === 'GREEN' ? '#16a34a' : '#dc2626';

        const created = barSeries.createPriceLine({
          price: line.price,
          color: jackColor,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          lineVisible: false,
          axisLabelVisible: true,
          title: JACK_SHORT_NAMES[line.key] || line.key,
        });
        priceLinesRef.current.push(created);
      }
    }

    if (preferences.showOggy) {
      const oggyEntries = [
        data.Oggy.Oggy_Minus1,
        data.Oggy.Oggy_0,
        data.Oggy.Oggy_Plus1,
      ];
      for (const line of oggyEntries) {
        if (
          !line ||
          (!line.shouldPlotOnChart && !matchedLabelSet.has(line.label)) ||
          isBrokenByLivePrice(line)
        ) {
          continue;
        }
        activeBaselines.push(line);
        // Strict visual rule: ALL Oggy lines (-1, 0, +1) MUST be rendered in BLUE
        const oggyBlue = '#2563eb';

        const created = barSeries.createPriceLine({
          price: line.price,
          color: oggyBlue,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          lineVisible: false,
          axisLabelVisible: true,
          title: OGGY_SHORT_NAMES[line.key] || line.key,
        });
        priceLinesRef.current.push(created);
      }
    }

    // SAR Wilder AT.S + Vertical Grey Origin Lines + Horizontal Polarity Rays + Setup 1234 ("2 billes noires")
    const lastBarTime =
      data.bars.length > 0 ? data.bars[data.bars.length - 1].time : null;
    sarPrimitive?.setData({
      bars: data.bars,
      sarPoints: data.parabolicSAR,
      showSAR: preferences.showSAR,
      originTimes,
      activeBaselines,
      setup1234: data.setup1234,
      latestBarTime: lastBarTime,
      showSetupOverlay: preferences.showDidi,
    });

    // Default Viewport: Strictly Last 25 Periods (-25 barres par défaut), zoomable in/out
    const totalBars = data.bars.length;
    if (totalBars > 0) {
      const defaultPeriods = 25;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, totalBars - defaultPeriods),
        to: totalBars + 3.5,
      });
    }
  }, [
    data,
    livePrice,
    matchedLabelsKey,
    preferences.showBollinger,
    preferences.showSAR,
    preferences.showJack,
    preferences.showOggy,
    preferences.showDidi,
  ]);

  // 3. Crosshair Synchronization across D, W, M, 12M, 6M, 3M
  useEffect(() => {
    const chart = chartRef.current;
    const barSeries = barSeriesRef.current;
    if (!chart || !barSeries) return;

    const barMap = new Map<string, OHLCVBar>();
    for (const b of data.bars) {
      barMap.set(b.time, b);
    }

    const handleCrosshairMove = (param: { time?: Time }) => {
      if (isProgrammaticSyncRef.current) return;

      if (!param.time) {
        setHudBar(data.bars.length > 0 ? data.bars[data.bars.length - 1] : null);
        if (preferences.syncCrosshair && syncBus) {
          syncBus.emit(data.timeframe, null);
        }
        return;
      }

      const dateStr = String(param.time);
      const matched = barMap.get(dateStr);
      if (matched) {
        setHudBar(matched);
      }

      if (preferences.syncCrosshair && syncBus) {
        const broadcastDate = matched ? matched.periodEnd : dateStr;
        syncBus.emit(data.timeframe, broadcastDate);
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    let unregisterBus: (() => void) | undefined;
    if (syncBus) {
      unregisterBus = syncBus.register(data.timeframe, ({ hoveredDate }) => {
        if (!preferences.syncCrosshair) return;

        isProgrammaticSyncRef.current = true;
        try {
          if (!hoveredDate) {
            chart.clearCrosshairPosition();
            setHudBar(
              data.bars.length > 0 ? data.bars[data.bars.length - 1] : null
            );
            return;
          }

          const targetBar = findCorrespondingBarForDate(
            hoveredDate,
            data.timeframe,
            data.bars
          );
          if (targetBar) {
            chart.setCrosshairPosition(
              targetBar.close,
              targetBar.time as Time,
              barSeries
            );
            setHudBar(targetBar);
          }
        } finally {
          isProgrammaticSyncRef.current = false;
        }
      });
    }

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      unregisterBus?.();
    };
  }, [data.bars, data.timeframe, preferences.syncCrosshair, syncBus]);

  const unpiercedLines = flattenTimeframeBaselines(
    data.Jack,
    data.Oggy,
    true
  ).filter((l) =>
    l.polarity === 'GREEN' ? l.price <= livePrice : l.price >= livePrice
  );
  const jackGreenCount = unpiercedLines.filter(
    (l) => l.family === 'Jack' && l.polarity === 'GREEN'
  ).length;
  const jackRedCount = unpiercedLines.filter(
    (l) => l.family === 'Jack' && l.polarity === 'RED'
  ).length;
  const oggyBlueCount = unpiercedLines.filter(
    (l) => l.family === 'Oggy'
  ).length;

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-white overflow-hidden transition-all shadow-sm',
        wallHighlightType === 'RESISTANCE'
          ? 'border-rose-400 ring-1 ring-rose-300'
          : isHighlightedWallTimeframe || wallHighlightType === 'SUPPORT'
          ? 'border-emerald-500 ring-1 ring-emerald-300'
          : 'border-slate-200'
      )}
    >
      {/* Compact Timeframe Header + Setup 1-2-3-4 Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-5 items-center rounded bg-slate-900 px-1.5 font-mono text-xs font-bold text-white">
            {data.timeframe}
          </span>
          <span className="text-xs font-semibold text-slate-700 hidden sm:inline">
            {TIMEFRAME_LABELS[data.timeframe]}
          </span>

          {data.setup1234.status !== 'NONE' && (() => {
            const stepNum: 1 | 2 | 3 | 4 =
              data.setup1234.stepNumber ??
              (data.setup1234.status === 'CANDIDATE'
                ? 1
                : data.setup1234.tp2Hit
                ? 4
                : data.setup1234.tp1Hit
                ? 3
                : 2);
            const sideTag = data.setup1234.isBull ? 'BUY' : 'SELL';
            const stepChain =
              stepNum === 1
                ? '1'
                : stepNum === 2
                ? '1→2'
                : stepNum === 3
                ? '1→2→3'
                : '1→2→3→4';
            return (
              <Badge
                variant={
                  stepNum === 1
                    ? 'amber'
                    : data.setup1234.isBull
                    ? 'support'
                    : 'resistance'
                }
                className="text-[10px] py-0 px-1.5 font-mono font-bold"
              >
                STEP {stepChain} · {sideTag}
              </Badge>
            );
          })()}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-mono">
          <span
            className="text-emerald-700 font-bold"
            title="Unbroken Green Jack Supports"
          >
            {jackGreenCount}JG
          </span>
          <span className="text-slate-400">/</span>
          <span
            className="text-rose-700 font-bold"
            title="Unbroken Red Jack Resistances"
          >
            {jackRedCount}JR
          </span>
          <span className="text-slate-400">/</span>
          <span
            className="text-blue-600 font-bold"
            title="Unbroken Blue Oggy Lines"
          >
            {oggyBlueCount}OB
          </span>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="ml-1.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-sans font-medium text-slate-700 hover:bg-slate-100"
              title={isExpanded ? 'Grille 6 graphiques' : 'Agrandir'}
            >
              {isExpanded ? 'Grille' : 'Focus'}
            </button>
          )}
        </div>
      </div>

      {/* Synchronized OHLC + M7/M20 HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 bg-white px-3 py-1 text-[11px] font-mono text-slate-500">
        <div className="flex items-center gap-2 truncate">
          <span className="text-slate-800 font-semibold">
            {hudBar ? hudBar.bucketKey : '—'}
          </span>
          {hudBar && (
            <>
              <span>
                O:
                <span className="text-slate-800 ml-0.5">
                  {formatPrice(hudBar.open, category)}
                </span>
              </span>
              <span>
                H:
                <span className="text-emerald-700 font-medium ml-0.5">
                  {formatPrice(hudBar.high, category)}
                </span>
              </span>
              <span>
                L:
                <span className="text-rose-700 font-medium ml-0.5">
                  {formatPrice(hudBar.low, category)}
                </span>
              </span>
              <span>
                C:
                <span className="text-slate-950 font-bold ml-0.5">
                  {formatPrice(hudBar.close, category)}
                </span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] font-semibold">
          {data.latestSMA7 && (
            <span
              className={cn(
                data.latestSMA7.isGreen ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              M7:{formatPrice(data.latestSMA7.value, category)}
            </span>
          )}
          {data.latestSMA20 && (
            <span
              className={cn(
                data.latestSMA20.isGreen ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              M20:{formatPrice(data.latestSMA20.value, category)}
            </span>
          )}
        </div>
      </div>

      {/* TradingView Lightweight Chart Canvas */}
      <div
        ref={containerRef}
        className={cn(
          'w-full flex-1 bg-white',
          isExpanded ? 'min-h-[540px]' : 'min-h-[265px]'
        )}
      />
    </div>
  );
};
