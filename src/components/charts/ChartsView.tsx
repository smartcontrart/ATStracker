'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Crosshair,
  Eye,
  Gauge,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { ATSChart } from '@/components/charts/ATSChart';
import { CrosshairSyncBus } from '@/components/charts/crosshairSyncBus';
import { triggerGlobalAssetLookup } from '@/components/search/GlobalAssetLookup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn, formatPrice } from '@/lib/utils';
import { useATSStore } from '@/store/useATSStore';
import {
  ALL_TIMEFRAMES,
  type AssetCategory,
  type ATSBaseline,
  type MTFAssetPayload,
  type ScreenerResult,
  type Timeframe,
} from '@/types/ats';

interface ChartsViewProps {
  onBackToScreener: () => void;
  onChangeTicker: (symbol: string, category: AssetCategory) => void;
}

function renderBaselineCell(line: ATSBaseline | null, category: AssetCategory) {
  if (!line) {
    return <span className="text-slate-600 text-xs font-mono">N/A</span>;
  }

  const isGreen = line.polarity === 'GREEN';
  return (
    <div className="font-mono text-xs">
      <span
        className={cn(
          'font-semibold',
          isGreen ? 'text-emerald-400' : 'text-rose-400'
        )}
      >
        {formatPrice(line.price, category)}
      </span>
      <span className="ml-1.5 text-[10px] text-slate-500">
        ({line.distancePct >= 0 ? '+' : ''}
        {line.distancePct.toFixed(1)}%)
      </span>
    </div>
  );
}

export const ChartsView: React.FC<ChartsViewProps> = ({
  onBackToScreener,
  onChangeTicker,
}) => {
  const {
    selectedAsset,
    uiPreferences,
    toggleUIPreference,
    watchlists,
    screenerResults,
    addTicker,
    upsertSingleScreenerResult,
    appendScreenerBatch,
    scanProgress,
  } = useATSStore();

  const [payload, setPayload] = useState<MTFAssetPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [quickSymbol, setQuickSymbol] = useState('');
  const [focusedTf, setFocusedTf] = useState<Timeframe | null>(null);

  const syncBus = useMemo(() => new CrosshairSyncBus(), []);

  const fetchAssetMTF = useCallback(
    async (symbol: string, category: AssetCategory) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ symbol, category });
        const res = await fetch(`/api/market?${qs.toString()}`);
        const json = await res.json();

        if (!res.ok) {
          throw new Error(
            json?.error || `Failed to load ${symbol} (${res.status})`
          );
        }

        const loaded = json as MTFAssetPayload;
        setPayload(loaded);
        // Ensure every ticker opened on the 6-Chart page stores its live Confidence Score
        upsertSingleScreenerResult(loaded.screener);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to fetch MTF chart data'
        );
      } finally {
        setLoading(false);
      }
    },
    [upsertSingleScreenerResult]
  );

  useEffect(() => {
    void fetchAssetMTF(selectedAsset.symbol, selectedAsset.category);
  }, [fetchAssetMTF, selectedAsset.category, selectedAsset.symbol]);

  const handleQuickJump = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSymbol.trim()) return;
    const added = addTicker(quickSymbol, selectedAsset.category);
    if (added) {
      onChangeTicker(added, selectedAsset.category);
      setQuickSymbol('');
    }
  };

  const wallTypeByTf = useMemo(() => {
    const map = new Map<Timeframe, 'SUPPORT' | 'RESISTANCE'>();
    if (!payload) return map;
    for (const l of payload.screener.confluentWallLines) {
      map.set(l.timeframe, 'SUPPORT');
    }
    for (const l of payload.screener.confluentResistanceLines) {
      if (!map.has(l.timeframe) || payload.screener.direction === 'SHORT') {
        map.set(l.timeframe, 'RESISTANCE');
      }
    }
    return map;
  }, [payload]);

  // Quick-switch ribbon: top scored candidates + custom watchlist, with score lookup map
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScreenerResult>();
    for (const r of screenerResults[selectedAsset.category]) {
      map.set(r.symbol, r);
    }
    if (payload && payload.category === selectedAsset.category) {
      map.set(payload.symbol, payload.screener);
    }
    return map;
  }, [payload, screenerResults, selectedAsset.category]);

  const quickSwitchSymbols = useMemo(() => {
    const topScoredSyms = [...screenerResults[selectedAsset.category]]
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 14)
      .map((r) => r.symbol);

    return Array.from(
      new Set([
        selectedAsset.symbol,
        ...topScoredSyms,
        ...watchlists[selectedAsset.category],
      ])
    ).slice(0, 24);
  }, [
    screenerResults,
    selectedAsset.category,
    selectedAsset.symbol,
    watchlists,
  ]);

  // Ensure every ticker in the Quick-Switch Ribbon on the 6-Chart Page has a Confidence Score
  const missingRibbonKey = useMemo(() => {
    return quickSwitchSymbols.filter((s) => !scoreMap.has(s)).join(',');
  }, [quickSwitchSymbols, scoreMap]);

  useEffect(() => {
    if (!missingRibbonKey) return;
    let cancelled = false;
    const qs = new URLSearchParams({
      category: selectedAsset.category,
      symbols: missingRibbonKey,
    });

    fetch(`/api/screener?${qs.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json || !Array.isArray(json.results)) return;
        const cur = scanProgress[selectedAsset.category];
        appendScreenerBatch(
          selectedAsset.category,
          json.results as ScreenerResult[],
          cur.completed,
          cur.total
        );
      })
      .catch(() => {
        // Non-fatal
      });

    return () => {
      cancelled = true;
    };
  }, [
    appendScreenerBatch,
    missingRibbonKey,
    scanProgress,
    selectedAsset.category,
  ]);

  const isShortSetup = payload?.screener.direction === 'SHORT';

  return (
    <div className="space-y-4">
      {/* Top Asset Command & Prominent Confidence Score Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800/90 bg-slate-900/55 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBackToScreener}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Screener
            </Button>

            {payload ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <h1 className="font-mono text-xl font-bold text-white">
                    {payload.displaySymbol}
                  </h1>
                  <span className="text-xs text-slate-400 truncate max-w-[200px]">
                    {payload.name}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {payload.source}
                  </Badge>
                </div>

                <div className="flex items-baseline gap-2 font-mono">
                  <span className="text-xl font-bold text-white">
                    {formatPrice(payload.livePrice, payload.category)}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      payload.change24hPct >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    )}
                  >
                    {payload.change24hPct >= 0 ? '+' : ''}
                    {payload.change24hPct.toFixed(2)}%
                  </span>
                </div>

                <Badge
                  variant={
                    payload.screener.direction === 'SHORT'
                      ? 'resistance'
                      : payload.screener.direction === 'LONG'
                      ? 'support'
                      : 'outline'
                  }
                  className="font-mono"
                >
                  {payload.screener.direction} • {payload.screener.activeWallLabel}
                </Badge>
              </div>
            ) : (
              <div className="font-mono text-sm text-slate-400">
                Loading {selectedAsset.symbol} MTF Matrix...
              </div>
            )}
          </div>

          {/* Quick Ticker Switch + Universal Lookup + Refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => triggerGlobalAssetLookup()}
            >
              <Search className="h-3.5 w-3.5" />
              Search Any Asset (⌘K)
            </Button>

            <form
              onSubmit={handleQuickJump}
              className="flex items-center gap-1.5"
            >
              <Input
                value={quickSymbol}
                onChange={(e) => setQuickSymbol(e.target.value)}
                placeholder="Jump ticker..."
                className="h-8 w-36 font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="secondary">
                Load
              </Button>
            </form>

            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() =>
                void fetchAssetMTF(selectedAsset.symbol, selectedAsset.category)
              }
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Dedicated Confidence Score Gauge + 6-Horizon Polarity Summary (Shown for ALL Tickers) */}
        {payload && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800/90 bg-slate-950/80 p-3.5 lg:grid-cols-12 lg:items-center">
            {/* Prominent Confidence Score Meter */}
            <div className="flex items-center gap-3.5 lg:col-span-4 lg:border-r lg:border-slate-800/90 lg:pr-4">
              <div
                className={cn(
                  'flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-xl border font-mono',
                  payload.screener.confidenceScore >= 70
                    ? payload.screener.direction === 'SHORT'
                      ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                      : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : payload.screener.confidenceScore >= 45
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                )}
              >
                <span className="text-lg font-extrabold leading-none">
                  {payload.screener.confidenceScore}%
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider opacity-80">
                  Score
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                    ATS Confidence Score
                  </span>
                  <Badge
                    variant={
                      payload.screener.setupStep >= 3
                        ? 'support'
                        : payload.screener.setupStep >= 1
                        ? 'amber'
                        : 'outline'
                    }
                    className="font-mono text-[10px] py-0 px-1.5"
                  >
                    {payload.screener.setupStep > 0
                      ? `STEP ${payload.screener.setupStep}/4`
                      : 'WATCH'}
                  </Badge>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      payload.screener.confidenceScore >= 70
                        ? payload.screener.direction === 'SHORT'
                          ? 'bg-rose-400'
                          : 'bg-emerald-400'
                        : payload.screener.confidenceScore >= 45
                        ? 'bg-amber-400'
                        : 'bg-slate-500'
                    )}
                    style={{ width: `${payload.screener.confidenceScore}%` }}
                  />
                </div>

                <p className="truncate text-[11px] text-slate-400" title={payload.screener.thesisHeadline}>
                  {payload.screener.thesisHeadline}
                </p>
              </div>
            </div>

            {/* 6-Timeframe Polarity Strip (D, W, M, 3M, 6M, 12M) */}
            <div className="lg:col-span-8 space-y-1.5">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {ALL_TIMEFRAMES.map((tf) => {
                  const h = payload.screener.horizonMatrix[tf];
                  const hasTouch = h.wallTouches.length > 0;
                  const touchPol = h.wallTouches[0]?.polarity;
                  return (
                    <div
                      key={tf}
                      className={cn(
                        'rounded-lg border px-2 py-1 text-center font-mono text-[10px]',
                        hasTouch
                          ? touchPol === 'RED'
                            ? 'border-rose-400 bg-rose-500/15 text-rose-200'
                            : 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300'
                      )}
                    >
                      <div className="font-bold">
                        {tf} {hasTouch ? '★' : ''}
                      </div>
                      <div>
                        <span className="text-emerald-400">{h.greenCount}G</span>
                        <span className="text-slate-600"> / </span>
                        <span className="text-rose-400">{h.redCount}R</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-300 leading-snug">
                <span className="font-semibold text-slate-100">Thesis: </span>
                {payload.screener.thesisHeadline}
              </p>
            </div>
          </div>
        )}

        {/* ATS Execution Levels Strip + Layer Toggles */}
        <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-2.5 lg:flex-row lg:items-center lg:justify-between">
          {payload && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono">
              <div>
                <span className="text-slate-500">
                  SL ({isShortSetup ? '+1% Wall' : '-1% Wall'}):{' '}
                </span>
                <span className="text-rose-400 font-semibold">
                  {formatPrice(payload.screener.stopLoss, payload.category)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">TP1 (Didi): </span>
                {payload.screener.effectiveTargetTP1 ? (
                  <span className="text-emerald-300 font-semibold">
                    {formatPrice(
                      payload.screener.effectiveTargetTP1.price,
                      payload.category
                    )}{' '}
                    ({payload.screener.effectiveTargetTP1.label},{' '}
                    {isShortSetup ? '-' : '+'}
                    {payload.screener.effectiveTargetTP1.upsidePct.toFixed(1)}%)
                  </span>
                ) : (
                  <span className="text-slate-400">Open Discovery</span>
                )}
              </div>
              {payload.screener.macroTargetTP2 && (
                <div>
                  <span className="text-slate-500">TP2 (Macro M20): </span>
                  <span className="text-sky-300 font-semibold">
                    {formatPrice(
                      payload.screener.macroTargetTP2.price,
                      payload.category
                    )}{' '}
                    ({payload.screener.macroTargetTP2.label})
                  </span>
                </div>
              )}
              {payload.screener.riskRewardRatio !== null && (
                <div>
                  <span className="text-slate-500">R:R: </span>
                  <span className="text-amber-300 font-semibold">
                    {payload.screener.riskRewardRatio.toFixed(2)}x
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Layer Visibility & Crosshair Sync Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleUIPreference('showJack')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                uiPreferences.showJack
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              )}
            >
              <Layers className="h-3 w-3" />
              Jack (M20)
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showOggy')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                uiPreferences.showOggy
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              )}
            >
              <Layers className="h-3 w-3" />
              Oggy (M7)
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showBollinger')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                uiPreferences.showBollinger
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              )}
            >
              <Eye className="h-3 w-3" />
              BB Cloud (20,2)
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showSAR')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                uiPreferences.showSAR
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              )}
            >
              SAR Dots
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('syncCrosshair')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                uiPreferences.syncCrosshair
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              )}
            >
              <Crosshair className="h-3 w-3" />
              Sync Crosshair
            </button>
          </div>
        </div>

        {/* Quick-Switch Ticker Ribbon with Live Confidence Score on EVERY Ticker */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 mr-1 shrink-0">
            Tickers &amp; Confidence:
          </span>
          {quickSwitchSymbols.map((sym) => {
            const isSelected = sym === selectedAsset.symbol;
            const info = scoreMap.get(sym);
            const score = info?.confidenceScore ?? null;
            const dir = info?.direction ?? 'NEUTRAL';

            return (
              <button
                key={sym}
                type="button"
                onClick={() => onChangeTicker(sym, selectedAsset.category)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs transition-colors shrink-0 border',
                  isSelected
                    ? 'border-emerald-500/60 bg-emerald-500/20 text-white font-semibold'
                    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <span>{sym.replace(/=X$/, '')}</span>
                {score !== null && (
                  <span
                    className={cn(
                      'rounded px-1 text-[10px] font-bold',
                      score >= 70
                        ? dir === 'SHORT'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                        : score >= 45
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-slate-800 text-slate-400'
                    )}
                  >
                    {score}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Error loading MTF chart data</p>
            <p className="text-xs text-rose-300/80">{error}</p>
          </div>
        </div>
      )}

      {/* 6-Pane Simultaneous Multi-Timeframe Chart Grid (D, W, M, 3M, 6M, 12M) */}
      {loading && !payload ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ALL_TIMEFRAMES.map((tf) => (
            <div
              key={tf}
              className="flex h-[320px] flex-col justify-between rounded-xl border border-slate-800/80 bg-slate-950 p-4 animate-pulse"
            >
              <div className="h-5 w-32 rounded bg-slate-900" />
              <div className="h-56 w-full rounded bg-slate-900/60" />
            </div>
          ))}
        </div>
      ) : (
        payload && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ALL_TIMEFRAMES.map((tf) => {
                const isFocused = focusedTf === tf;
                const wallHighlight = wallTypeByTf.get(tf) ?? null;
                return (
                  <div
                    key={tf}
                    className={cn(
                      isFocused && 'md:col-span-2 xl:col-span-3 order-first'
                    )}
                  >
                    <ATSChart
                      data={payload.timeframes[tf]}
                      category={payload.category}
                      livePrice={payload.livePrice}
                      preferences={uiPreferences}
                      syncBus={syncBus}
                      isHighlightedWallTimeframe={wallHighlight !== null}
                      wallHighlightType={wallHighlight}
                      isExpanded={isFocused}
                      onExpand={() =>
                        setFocusedTf((prev) => (prev === tf ? null : tf))
                      }
                    />
                  </div>
                );
              })}
            </div>

            {/* Full Numerical MTF Jack & Oggy Polarity Matrix Audit Table */}
            <Card className="border-slate-800/90">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold text-slate-200">
                    Multi-Timeframe ATS Polarity Matrix — {payload.displaySymbol} (Confidence: {payload.screener.confidenceScore}%)
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-emerald-400">
                      ● GREEN = Support (Price &ge; Historical Close)
                    </span>
                    <span className="text-rose-400">
                      ● RED = Resistance (Price &lt; Historical Close)
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>TF</TableHead>
                      <TableHead>Jack -1 (t-21)</TableHead>
                      <TableHead>Jack 0 (t-20)</TableHead>
                      <TableHead>Jack +1 (t-19)</TableHead>
                      <TableHead>Oggy -1 (t-8)</TableHead>
                      <TableHead>Oggy 0 (t-7)</TableHead>
                      <TableHead>Oggy +1 (t-6)</TableHead>
                      <TableHead>BB M20 / Upper</TableHead>
                      <TableHead>SAR Polarity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ALL_TIMEFRAMES.map((tf) => {
                      const tfData = payload.timeframes[tf];
                      return (
                        <TableRow key={tf}>
                          <TableCell className="font-mono font-bold text-white">
                            {tf}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_Minus1,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_0,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_Plus1,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_Minus1,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_0,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_Plus1,
                              payload.category
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-sky-300">
                            {tfData.latestBB ? (
                              <>
                                {formatPrice(
                                  tfData.latestBB.mid,
                                  payload.category
                                )}{' '}
                                <span className="text-slate-500">/</span>{' '}
                                {formatPrice(
                                  tfData.latestBB.upper,
                                  payload.category
                                )}
                              </>
                            ) : (
                              <span className="text-slate-600">N/A</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {tfData.latestSAR ? (
                              <Badge
                                variant={
                                  tfData.latestSAR.isBullish
                                    ? 'support'
                                    : 'resistance'
                                }
                                className="font-mono text-[10px]"
                              >
                                {tfData.latestSAR.isBullish ? 'BULL' : 'BEAR'}
                                {tfData.latestSAR.isFlip ? ' (FLIP!)' : ''}
                              </Badge>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
};
