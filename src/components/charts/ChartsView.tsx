'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Crosshair,
  Eye,
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
import { MarketToggle } from '@/components/ui/market-toggle';
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
  type AtsState,
  CHART_GRID_TIMEFRAMES,
  type MTFAssetPayload,
  type ScreenerResult,
  type Timeframe,
} from '@/types/ats';

interface ChartsViewProps {
  onBackToScreener: () => void;
  onChangeTicker: (symbol: string, category: AssetCategory) => void;
  onSwitchCategory: (category: AssetCategory) => void;
}

/**
 * Strict Rendering Rule:
 * - Hide Pierced Lines: if pierced or Green support > livePrice or Red resistance < livePrice, remove from UI ("—").
 * - Oggy lines render in BLUE; Jack lines retain Green=Support / Red=Resistance.
 */
function renderBaselineCell(
  line: ATSBaseline | null,
  category: AssetCategory,
  livePrice: number
) {
  if (
    !line ||
    line.isPierced ||
    (line.polarity === 'GREEN' && line.price > livePrice) ||
    (line.polarity === 'RED' && line.price < livePrice)
  ) {
    return <span className="text-slate-300 text-xs font-mono">—</span>;
  }

  const colorClass =
    line.family === 'Oggy'
      ? 'text-blue-600'
      : line.polarity === 'GREEN'
      ? 'text-emerald-700'
      : 'text-rose-700';

  return (
    <div className="font-mono text-xs">
      <span className={cn('font-bold', colorClass)}>
        {formatPrice(line.price, category)}
      </span>
      <span className="ml-1.5 text-[10px] text-slate-500">
        ({line.distancePct >= 0 ? '+' : ''}
        {line.distancePct.toFixed(1)}%)
      </span>
    </div>
  );
}

function stateBadgeVariant(
  state: AtsState,
  setupSide: 'BUY' | 'SELL' | 'NONE'
): 'support' | 'resistance' | 'amber' | 'outline' {
  if (state === 'STEP 2: REVERSAL CONFIRMED') {
    return setupSide === 'SELL' ? 'resistance' : 'support';
  }
  if (state === 'STEP 1: THE WALL') {
    return 'amber';
  }
  if (state === 'INVALIDATED') {
    return 'resistance';
  }
  return 'outline';
}

export const ChartsView: React.FC<ChartsViewProps> = ({
  onBackToScreener,
  onChangeTicker,
  onSwitchCategory,
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
    const activeSideType =
      payload.screener.setupSide === 'SELL' ? 'RESISTANCE' : 'SUPPORT';
    for (const m of payload.screener.matchedHtfLevels || []) {
      map.set(m.timeframe, activeSideType);
    }
    for (const l of payload.screener.confluentWallLines) {
      if (!map.has(l.timeframe)) map.set(l.timeframe, 'SUPPORT');
    }
    for (const l of payload.screener.confluentResistanceLines) {
      if (!map.has(l.timeframe) || payload.screener.direction === 'SHORT') {
        map.set(l.timeframe, 'RESISTANCE');
      }
    }
    return map;
  }, [payload]);

  const categoryResults = screenerResults[selectedAsset.category];

  const scoreMap = useMemo(() => {
    const m = new Map<string, ScreenerResult>();
    for (const r of categoryResults) {
      m.set(r.symbol, r);
    }
    return m;
  }, [categoryResults]);

  const quickSwitchSymbols = useMemo(() => {
    if (categoryResults.length > 0) {
      const topSyms = categoryResults.slice(0, 14).map((r) => r.symbol);
      if (!topSyms.includes(selectedAsset.symbol)) {
        return [selectedAsset.symbol, ...topSyms];
      }
      return topSyms;
    }
    const wl = watchlists[selectedAsset.category];
    if (!wl.includes(selectedAsset.symbol)) {
      return [selectedAsset.symbol, ...wl];
    }
    return wl;
  }, [categoryResults, selectedAsset.category, selectedAsset.symbol, watchlists]);

  useEffect(() => {
    if (categoryResults.length >= 5) return;
    const seeds = watchlists[selectedAsset.category].slice(0, 12);
    if (seeds.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          category: selectedAsset.category,
          symbols: seeds.join(','),
        });
        const res = await fetch(`/api/screener?${qs.toString()}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.results)) {
          const curProg = scanProgress[selectedAsset.category];
          appendScreenerBatch(
            selectedAsset.category,
            json.results as ScreenerResult[],
            Math.max(curProg.completed, json.results.length),
            Math.max(curProg.total, seeds.length)
          );
        }
      } catch {
        // Silent background warmup
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appendScreenerBatch,
    categoryResults.length,
    scanProgress,
    selectedAsset.category,
    watchlists,
  ]);

  const isShortSetup = payload?.screener.direction === 'SHORT';

  return (
    <div className="space-y-4">
      {/* Top Asset Command Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBackToScreener}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Screener
            </Button>

            <MarketToggle
              value={selectedAsset.category}
              onChange={onSwitchCategory}
              size="sm"
            />

            {payload ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <h1 className="font-mono text-xl font-bold text-slate-900">
                    {payload.displaySymbol}
                  </h1>
                  <span className="text-xs text-slate-500 truncate max-w-[200px]">
                    {payload.name}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {payload.source}
                  </Badge>
                </div>

                <div className="flex items-baseline gap-2 font-mono">
                  <span className="text-xl font-bold text-slate-900">
                    {formatPrice(payload.livePrice, payload.category)}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      payload.change24hPct >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    )}
                  >
                    {payload.change24hPct >= 0 ? '+' : ''}
                    {payload.change24hPct.toFixed(2)}%
                  </span>
                </div>

                {payload.screener.setupConfidenceScore > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-2 py-0.5 font-mono text-xs font-extrabold text-white',
                      payload.screener.setupConfidenceScore >= 75
                        ? 'bg-emerald-600'
                        : payload.screener.setupConfidenceScore >= 50
                        ? 'bg-amber-500'
                        : 'bg-slate-700'
                    )}
                  >
                    Score {payload.screener.setupConfidenceScore}/100
                  </span>
                )}

                {payload.screener.bbExitTimeframe &&
                  payload.screener.highestHtfTimeframe && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-2 py-0.5 font-mono text-xs font-extrabold text-white',
                        payload.screener.setupSide === 'SELL'
                          ? 'bg-rose-700'
                          : 'bg-emerald-700'
                      )}
                    >
                      {payload.screener.bbExitTimeframe} BB Exit →{' '}
                      {payload.screener.highestHtfTimeframe}{' '}
                      {payload.screener.setupSide === 'SELL' ? 'RES' : 'SUP'}
                    </span>
                  )}

                <Badge
                  variant={stateBadgeVariant(
                    payload.screener.atsState,
                    payload.screener.setupSide
                  )}
                  className="font-mono font-bold"
                >
                  {payload.screener.setupSide !== 'NONE' &&
                  payload.screener.atsState !== 'NO SETUP'
                    ? `${payload.screener.setupSide} • `
                    : ''}
                  {payload.screener.atsState}
                </Badge>
              </div>
            ) : (
              <div className="font-mono text-sm text-slate-500">
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

        {/* ATS State Detection Summary + Cluster Density + Risk to Didi + 6-Horizon Strip */}
        {payload && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 lg:grid-cols-12 lg:items-center">
            <div className="flex flex-col gap-2 lg:col-span-5 lg:border-r lg:border-slate-200 lg:pr-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge
                  variant={stateBadgeVariant(
                    payload.screener.atsState,
                    payload.screener.setupSide
                  )}
                  className="font-mono text-xs px-2.5 py-0.5 font-bold"
                >
                  {payload.screener.atsState}
                  {payload.screener.atsState === 'STEP 1: THE WALL'
                    ? ' (AGGRESSIVE)'
                    : payload.screener.atsState === 'STEP 2: REVERSAL CONFIRMED'
                    ? ' (CONSERVATIVE)'
                    : ''}
                </Badge>

                <span className="font-mono text-xs text-slate-600 font-semibold">
                  {payload.screener.activeWallLabel}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Confidence Score
                  </div>
                  <div className="mt-0.5 font-bold text-slate-900">
                    {payload.screener.setupConfidenceScore}/100
                  </div>
                  {payload.screener.scoreBreakdown && (
                    <div className="text-[9px] text-slate-500">
                      TF {payload.screener.scoreBreakdown.timeframePts} · S/R{' '}
                      {payload.screener.scoreBreakdown.srCountPts} · Didi{' '}
                      {payload.screener.scoreBreakdown.earlinessPts} · BB{' '}
                      {payload.screener.scoreBreakdown.bbDivergencePts}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Backing S/R Count
                  </div>
                  <div className="mt-0.5 font-bold text-slate-900">
                    {payload.screener.ClusterDensityCount}{' '}
                    {isShortSetup
                      ? payload.screener.ClusterDensityCount === 1
                        ? 'Resistance'
                        : 'Resistances'
                      : payload.screener.ClusterDensityCount === 1
                      ? 'Support'
                      : 'Supports'}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Earliness (Didi)
                  </div>
                  <div className="mt-0.5 font-bold text-rose-700">
                    {payload.screener.RiskToDidi.toFixed(2)}%{' '}
                    <span className="text-[10px] font-normal text-slate-500">
                      (@ {formatPrice(payload.screener.didiPrice, payload.category)})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 6-Timeframe Unbroken Horizon Strip */}
            <div className="lg:col-span-7 space-y-1.5">
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
                            ? 'border-rose-400 bg-rose-50 text-rose-900 font-semibold'
                            : 'border-emerald-400 bg-emerald-50 text-emerald-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700'
                      )}
                    >
                      <div className="font-bold">
                        {tf} {hasTouch ? '★' : ''}
                      </div>
                      <div>
                        <span className="text-emerald-700 font-semibold">
                          {h.greenCount}G
                        </span>
                        <span className="text-slate-400">/</span>
                        <span className="text-rose-700 font-semibold">
                          {h.redCount}R
                        </span>
                        <span className="text-slate-400">/</span>
                        <span className="text-blue-600 font-semibold">
                          {h.oggyCount}B
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-700 leading-snug">
                <span className="font-semibold text-slate-900">Setup Logic: </span>
                {payload.screener.thesisHeadline}
              </p>
              {payload.screener.matchedHtfLevels &&
                payload.screener.matchedHtfLevels.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-0.5 font-mono">
                    {payload.screener.matchedHtfLevels.map((lvl, idx) => (
                      <span
                        key={`${lvl.label}-${idx}`}
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                          lvl.kind === 'Oggy'
                            ? 'border-blue-300 bg-blue-50 text-blue-800'
                            : lvl.kind === 'SAR'
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                            : lvl.kind === 'MM7' || lvl.kind === 'MM20'
                            ? 'border-sky-300 bg-sky-50 text-sky-900'
                            : isShortSetup
                            ? 'border-rose-300 bg-rose-50 text-rose-800'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        )}
                      >
                        {lvl.label} ({formatPrice(lvl.price, payload.category)})
                      </span>
                    ))}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* ATS Execution Levels Strip + Layer Toggles */}
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-2.5 lg:flex-row lg:items-center lg:justify-between">
          {payload && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono">
              <div>
                <span className="text-slate-500">Didi Stop-Loss: </span>
                <span className="text-rose-700 font-bold">
                  {formatPrice(payload.screener.didiPrice, payload.category)} (
                  {payload.screener.RiskToDidi.toFixed(2)}% Risk)
                </span>
              </div>
              <div>
                <span className="text-slate-500">TP1 (M7): </span>
                {payload.screener.effectiveTargetTP1 ? (
                  <span className="text-emerald-700 font-bold">
                    {formatPrice(
                      payload.screener.effectiveTargetTP1.price,
                      payload.category
                    )}{' '}
                    ({payload.screener.effectiveTargetTP1.label},{' '}
                    {isShortSetup ? '-' : '+'}
                    {payload.screener.effectiveTargetTP1.upsidePct.toFixed(1)}%)
                  </span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </div>
              {payload.screener.macroTargetTP2 && (
                <div>
                  <span className="text-slate-500">TP2 (M20): </span>
                  <span className="text-sky-700 font-bold">
                    {formatPrice(
                      payload.screener.macroTargetTP2.price,
                      payload.category
                    )}{' '}
                    ({payload.screener.macroTargetTP2.label})
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
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.showJack
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              <Layers className="h-3 w-3" />
              Jack (Green/Red)
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showOggy')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.showOggy
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              <Layers className="h-3 w-3" />
              Oggy (Blue)
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showBollinger')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.showBollinger
                  ? 'border-amber-300 bg-yellow-100 text-amber-900'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              <Eye className="h-3 w-3" />
              BB Yellow Cloud
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showSAR')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.showSAR
                  ? 'border-sky-300 bg-sky-50 text-sky-800'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              SAR Wilder AT.S
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('showDidi')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.showDidi
                  ? 'border-slate-400 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              ● Setup 1234 &amp; 2 Billes
            </button>

            <button
              type="button"
              onClick={() => toggleUIPreference('syncCrosshair')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                uiPreferences.syncCrosshair
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  : 'border-slate-200 bg-slate-100 text-slate-400'
              )}
            >
              <Crosshair className="h-3 w-3" />
              Sync Crosshair
            </button>
          </div>
        </div>

        {/* Quick-Switch Ticker Ribbon with ATS State */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 mr-1 shrink-0 font-semibold">
            Tickers &amp; State:
          </span>
          {quickSwitchSymbols.map((sym) => {
            const isSelected = sym === selectedAsset.symbol;
            const info = scoreMap.get(sym);
            const st = info?.atsState ?? null;
            const dens = info?.ClusterDensityCount ?? 0;

            return (
              <button
                key={sym}
                type="button"
                onClick={() => onChangeTicker(sym, selectedAsset.category)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs transition-colors shrink-0 border',
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50 text-slate-950 font-bold shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                )}
              >
                <span>{sym.replace(/=X$/, '')}</span>
                {st !== null && (
                  <span
                    className={cn(
                      'rounded px-1 text-[9px] font-bold',
                      st === 'STEP 2: REVERSAL CONFIRMED'
                        ? info?.setupSide === 'SELL'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                        : st === 'STEP 1: THE WALL'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200 text-slate-600'
                    )}
                  >
                    {st === 'STEP 2: REVERSAL CONFIRMED' ||
                    st === 'STEP 1: THE WALL'
                      ? info?.bbExitTimeframe && info?.highestHtfTimeframe
                        ? `${info.bbExitTimeframe}→${info.highestHtfTimeframe}`
                        : `S${st === 'STEP 2: REVERSAL CONFIRMED' ? '2' : '1'}·${dens}L`
                      : st === 'INVALIDATED'
                      ? 'INVAL'
                      : 'NONE'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="font-semibold">Error loading MTF chart data</p>
            <p className="text-xs text-rose-700">{error}</p>
          </div>
        </div>
      )}

      {/* 6-Pane Simultaneous Multi-Timeframe Chart Grid: Top (D, W, M) / Bottom Inverted (12M, 6M, 3M) */}
      {loading && !payload ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CHART_GRID_TIMEFRAMES.map((tf) => (
            <div
              key={tf}
              className="flex h-[320px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 animate-pulse"
            >
              <div className="h-5 w-32 rounded bg-slate-100" />
              <div className="h-56 w-full rounded bg-slate-50" />
            </div>
          ))}
        </div>
      ) : (
        payload && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {CHART_GRID_TIMEFRAMES.map((tf) => {
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

            {/* Unbroken MTF Jack (Green/Red) & Oggy (Blue) Matrix Table — Pierced Lines Hidden */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Unbroken Multi-Timeframe Matrix — {payload.displaySymbol} (
                    {payload.screener.atsState})
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono font-semibold">
                    <span className="text-emerald-700">
                      ● JACK GREEN = Support
                    </span>
                    <span className="text-rose-700">
                      ● JACK RED = Resistance
                    </span>
                    <span className="text-blue-600">
                      ● OGGY BLUE = Unbroken Oggy (Pierced Hidden)
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
                          <TableCell className="font-mono font-bold text-slate-900">
                            {tf}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_Minus1,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_0,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Jack.Jack_Plus1,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_Minus1,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_0,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell>
                            {renderBaselineCell(
                              tfData.Oggy.Oggy_Plus1,
                              payload.category,
                              payload.livePrice
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-sky-700 font-semibold">
                            {tfData.latestBB ? (
                              <>
                                {formatPrice(
                                  tfData.latestBB.mid,
                                  payload.category
                                )}{' '}
                                <span className="text-slate-400">/</span>{' '}
                                {formatPrice(
                                  tfData.latestBB.upper,
                                  payload.category
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">N/A</span>
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
                              <span className="text-slate-400">—</span>
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
