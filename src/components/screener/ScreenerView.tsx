'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Target,
  Trash2,
} from 'lucide-react';
import { triggerGlobalAssetLookup } from '@/components/search/GlobalAssetLookup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { UNIVERSE_PRESETS } from '@/lib/assetUniverses';
import { compareScreenerResults, type ScreenerSortKey } from '@/lib/atsScreener';
import { cn, formatPrice } from '@/lib/utils';
import {
  type AtsStateFilter,
  type DirectionFilter,
  useATSStore,
} from '@/store/useATSStore';
import {
  ALL_TIMEFRAMES,
  type AssetCategory,
  type AtsState,
  type ScreenerResult,
} from '@/types/ats';

interface ScreenerViewProps {
  onSelectCandidate: (symbol: string, category: AssetCategory) => void;
  onSwitchCategory: (category: AssetCategory) => void;
}

const CATEGORY_PLACEHOLDERS: Record<AssetCategory, string> = {
  stocks: 'Add custom Stock/ETF (e.g., SNOW, ARM, SU.PA)...',
  crypto: 'Add custom Crypto (e.g., HYPE, TAO, PEPE)...',
  forex: 'Add custom FX pair (e.g., DXY, EURPLN, USDNOK)...',
};

const BATCH_SIZE = 25;

function getStateBadgeStyle(
  state: AtsState,
  setupSide: 'BUY' | 'SELL' | 'NONE'
): {
  variant: 'support' | 'resistance' | 'amber' | 'outline';
  subLabel: string;
} {
  if (state === 'STEP 2: REVERSAL CONFIRMED') {
    return {
      variant: setupSide === 'SELL' ? 'resistance' : 'support',
      subLabel: 'CONSERVATIVE • PHASE 3',
    };
  }
  if (state === 'STEP 1: THE WALL') {
    return {
      variant: 'amber',
      subLabel: 'AGGRESSIVE • PHASE 2',
    };
  }
  if (state === 'INVALIDATED') {
    return {
      variant: 'resistance',
      subLabel: 'DIDI BREACHED >1%',
    };
  }
  return {
    variant: 'outline',
    subLabel: 'GATEKEEPER FILTERED',
  };
}

export const ScreenerView: React.FC<ScreenerViewProps> = ({
  onSelectCandidate,
  onSwitchCategory,
}) => {
  const {
    activeCategory,
    universePreset,
    setUniversePreset,
    getActiveSymbolsForCategory,
    addTicker,
    removeTicker,
    screenerResults,
    screenerLoading,
    scanProgress,
    screenerErrors,
    lastScannedAt,
    startCategoryScan,
    appendScreenerBatch,
    finishCategoryScan,
    uiPreferences,
    setDirectionFilter,
    setStateFilter,
    setSortBy,
  } = useATSStore();

  const [tickerInput, setTickerInput] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(60);

  const abortControllerRef = useRef<AbortController | null>(null);

  const stopActiveScan = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    finishCategoryScan(activeCategory, null);
  }, [activeCategory, finishCategoryScan]);

  const runProgressiveUniverseScan = useCallback(
    async (category: AssetCategory, symbolsList: string[]) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (symbolsList.length === 0) {
        startCategoryScan(category, 0, true);
        finishCategoryScan(category, null);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      startCategoryScan(category, symbolsList.length, true);

      let completed = 0;
      const failedSymbols: string[] = [];

      try {
        for (let i = 0; i < symbolsList.length; i += BATCH_SIZE) {
          if (controller.signal.aborted) break;

          const chunk = symbolsList.slice(i, i + BATCH_SIZE);
          const qs = new URLSearchParams({
            category,
            symbols: chunk.join(','),
          });

          const res = await fetch(`/api/screener?${qs.toString()}`, {
            signal: controller.signal,
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.error || `Batch HTTP ${res.status}`);
          }

          const json = await res.json();
          completed += chunk.length;

          if (Array.isArray(json.errors)) {
            for (const e of json.errors) {
              if (e?.symbol) failedSymbols.push(e.symbol);
            }
          }

          appendScreenerBatch(
            category,
            (json.results || []) as ScreenerResult[],
            Math.min(completed, symbolsList.length),
            symbolsList.length
          );
        }

        if (!controller.signal.aborted) {
          const warnMsg =
            failedSymbols.length > 0
              ? `Completed with ${failedSymbols.length} unavailable symbol(s): ${failedSymbols
                  .slice(0, 5)
                  .join(', ')}${failedSymbols.length > 5 ? '…' : ''}`
              : null;
          finishCategoryScan(category, warnMsg);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        finishCategoryScan(
          category,
          err instanceof Error ? err.message : 'Screener batch scan failed'
        );
      }
    },
    [appendScreenerBatch, finishCategoryScan, startCategoryScan]
  );

  const currentPresetId = universePreset[activeCategory];

  useEffect(() => {
    const existing = screenerResults[activeCategory];
    const isBusy = screenerLoading[activeCategory];
    if (existing.length === 0 && !isBusy) {
      const syms = getActiveSymbolsForCategory(activeCategory);
      void runProgressiveUniverseScan(activeCategory, syms);
    }
  }, [
    activeCategory,
    currentPresetId,
    getActiveSymbolsForCategory,
    runProgressiveUniverseScan,
    screenerLoading,
    screenerResults,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleAddSingleTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerInput.trim()) return;

    const added = addTicker(tickerInput, activeCategory);
    setTickerInput('');
    if (!added) return;

    try {
      const qs = new URLSearchParams({
        category: activeCategory,
        symbols: added,
      });
      const res = await fetch(`/api/screener?${qs.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const curProgress =
          useATSStore.getState().scanProgress[activeCategory];
        appendScreenerBatch(
          activeCategory,
          (json.results || []) as ScreenerResult[],
          curProgress.completed + 1,
          curProgress.total + 1
        );
      }
    } catch {
      // Non-fatal
    }
  };

  const rows = screenerResults[activeCategory];
  const isScanning = screenerLoading[activeCategory];
  const progress = scanProgress[activeCategory];
  const scanError = screenerErrors[activeCategory];
  const scannedTimestamp = lastScannedAt[activeCategory];

  const activeSort: ScreenerSortKey = uiPreferences.sortBy || 'STATE';
  const activeStateFilter: AtsStateFilter = uiPreferences.stateFilter || 'ALL';

  const step2Count = useMemo(
    () =>
      rows.filter((r) => r.atsState === 'STEP 2: REVERSAL CONFIRMED').length,
    [rows]
  );
  const step1Count = useMemo(
    () => rows.filter((r) => r.atsState === 'STEP 1: THE WALL').length,
    [rows]
  );
  const activeBuySellCounts = useMemo(() => {
    let buy = 0;
    let sell = 0;
    for (const r of rows) {
      if (
        r.atsState === 'STEP 1: THE WALL' ||
        r.atsState === 'STEP 2: REVERSAL CONFIRMED'
      ) {
        if (r.setupSide === 'BUY') buy++;
        else if (r.setupSide === 'SELL') sell++;
      }
    }
    return { buy, sell };
  }, [rows]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareScreenerResults(a, b, activeSort)),
    [activeSort, rows]
  );

  const topActiveSetups = useMemo(
    () =>
      sortedRows
        .filter(
          (r) =>
            r.atsState === 'STEP 2: REVERSAL CONFIRMED' ||
            r.atsState === 'STEP 1: THE WALL'
        )
        .slice(0, 6),
    [sortedRows]
  );

  const filteredRows = useMemo(() => {
    const query = tableSearch.trim().toUpperCase();
    return sortedRows.filter((r) => {
      if (activeStateFilter === 'ACTIVE') {
        if (
          r.atsState !== 'STEP 1: THE WALL' &&
          r.atsState !== 'STEP 2: REVERSAL CONFIRMED'
        ) {
          return false;
        }
      } else if (activeStateFilter === 'STEP2') {
        if (r.atsState !== 'STEP 2: REVERSAL CONFIRMED') return false;
      } else if (activeStateFilter === 'STEP1') {
        if (r.atsState !== 'STEP 1: THE WALL') return false;
      } else if (activeStateFilter === 'INVALIDATED') {
        if (r.atsState !== 'INVALIDATED') return false;
      }

      if (
        uiPreferences.directionFilter === 'LONG' &&
        r.setupSide !== 'BUY'
      ) {
        return false;
      }
      if (
        uiPreferences.directionFilter === 'SHORT' &&
        r.setupSide !== 'SELL'
      ) {
        return false;
      }

      if (query) {
        const matchedStr = (r.matchedHtfLevels || [])
          .map((m) => `${m.label} ${m.kind}`)
          .join(' ');
        const tfPair =
          r.bbExitTimeframe && r.highestHtfTimeframe
            ? `${r.bbExitTimeframe} ${r.highestHtfTimeframe} ${r.bbExitTimeframe}->${r.highestHtfTimeframe}`
            : '';
        const hay = `${r.symbol} ${r.displaySymbol} ${r.name || ''} ${
          r.atsState
        } ${tfPair} ${matchedStr} ${r.activeWallLabel} ${
          r.thesisHeadline
        }`.toUpperCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [
    activeStateFilter,
    sortedRows,
    tableSearch,
    uiPreferences.directionFilter,
  ]);

  const displayedRows = filteredRows.slice(0, visibleLimit);
  const progressPct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : 0;

  const presetsForCategory = UNIVERSE_PRESETS[activeCategory];
  const corePresets = presetsForCategory.filter((p) => p.group !== 'thematic');
  const thematicPresets = presetsForCategory.filter(
    (p) => p.group === 'thematic'
  );

  return (
    <div className="space-y-5">
      {/* Header & Market Toggle + Scan Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              ATS Multi-Timeframe BB-Exit Screener
            </h1>
            <Badge variant="support" className="font-mono">
              BB EXIT + HTF S/R
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            Flags price exiting a Bollinger Band (
            <span className="text-emerald-700 font-semibold">Bottom = Buy</span>{' '}
            /{' '}
            <span className="text-rose-700 font-semibold">Top = Sell</span>)
            into a strictly higher-timeframe{' '}
            <span className="font-semibold text-slate-800">
              BB (Green=Sup / Red=Res), SAR, MM7, MM20, Jack, or Oggy
            </span>{' '}
            level. Ranked highest timeframe first (
            <span className="font-mono text-slate-800">
              6M→12M &gt; 3M→6M/12M &gt; M→3M &gt; W→M &gt; D→W
            </span>
            ).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MarketToggle
            value={activeCategory}
            onChange={(cat) => {
              if (isScanning) stopActiveScan();
              onSwitchCategory(cat);
            }}
          />

          <Button
            variant="default"
            size="sm"
            onClick={() => triggerGlobalAssetLookup()}
          >
            <Search className="h-3.5 w-3.5" />
            Lookup Any Asset (⌘K)
          </Button>

          {isScanning ? (
            <Button variant="destructive" size="sm" onClick={stopActiveScan}>
              <Square className="h-3.5 w-3.5" />
              Stop Scan
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const syms = getActiveSymbolsForCategory(activeCategory);
                void runProgressiveUniverseScan(activeCategory, syms);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Rescan ({getActiveSymbolsForCategory(activeCategory).length})
            </Button>
          )}
        </div>
      </div>

      {/* Live Streaming Batch Progress Bar */}
      {isScanning && progress.total > 0 && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-emerald-800 font-semibold flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Evaluating ATS States: {progress.completed} / {progress.total}{' '}
              assets ({progressPct}%)
            </span>
            <span className="text-slate-600">
              Active Setups:{' '}
              <strong className="text-emerald-700">
                {step2Count} Step 2 Confirmed
              </strong>{' '}
              ·{' '}
              <strong className="text-amber-700">
                {step1Count} Step 1 Wall
              </strong>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-200">
            <div
              className="h-full bg-emerald-600 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                STEP 2 • Reversal Confirmed
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-emerald-700">
                {step2Count}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (Conservative · Phase 3)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-700">
              <Activity className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                STEP 1 • The Wall
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-amber-700">
                {step1Count}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (Aggressive · Phase 2)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-amber-700">
              <Layers className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Active BUY vs SELL Setups
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-slate-900">
                <span className="text-emerald-700">
                  {activeBuySellCounts.buy}B
                </span>
                <span className="text-slate-300 mx-1.5">/</span>
                <span className="text-rose-700">
                  {activeBuySellCounts.sell}S
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-2.5 text-sky-700">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Universe Coverage
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-slate-900">
                {rows.length}{' '}
                <span className="text-xs font-normal text-slate-500">
                  Assets Scanned
                </span>
              </p>
              <p className="text-[11px] text-slate-400">
                {scannedTimestamp
                  ? `Updated ${new Date(scannedTimestamp).toLocaleTimeString()}`
                  : 'Scanning...'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-100 border border-slate-200 p-2.5 text-slate-700">
              <Target className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Universe Selector + State Filter + Sort Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">
              Universe:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {corePresets.map((preset) => {
                const active = currentPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.description}
                    onClick={() => {
                      if (isScanning) stopActiveScan();
                      setUniversePreset(activeCategory, preset.id);
                    }}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                      active
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            onSubmit={(e) => void handleAddSingleTicker(e)}
            className="flex w-full max-w-sm items-center gap-2"
          >
            <Input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder={CATEGORY_PLACEHOLDERS[activeCategory]}
              className="font-mono text-xs h-8"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!tickerInput.trim()}
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </form>
        </div>

        {/* 14 Thematic Stock Lists (.itf Sectors) */}
        {thematicPresets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
              14 Thématiques AT.S:
            </span>
            {thematicPresets.map((preset) => {
              const active = currentPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  onClick={() => {
                    if (isScanning) stopActiveScan();
                    setUniversePreset(activeCategory, preset.id);
                  }}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-sky-500 bg-sky-50 text-sky-900 font-semibold shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        )}

        {/* State Filters + Direction Filters + Sorting Controls + Search */}
        <div className="flex flex-col gap-2.5 border-t border-slate-200 pt-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {/* State Filter Pills */}
            <div className="inline-flex flex-wrap items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              {(
                [
                  { id: 'ALL', label: 'All States' },
                  { id: 'ACTIVE', label: 'Active (Step 1 & 2)' },
                  { id: 'STEP2', label: 'Step 2 Confirmed' },
                  { id: 'STEP1', label: 'Step 1 Wall' },
                  { id: 'INVALIDATED', label: 'Invalidated' },
                ] as Array<{ id: AtsStateFilter; label: string }>
              ).map((stOpt) => {
                const active = activeStateFilter === stOpt.id;
                return (
                  <button
                    key={stOpt.id}
                    type="button"
                    onClick={() => setStateFilter(stOpt.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-white text-slate-900 shadow-sm font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    {stOpt.label}
                  </button>
                );
              })}
            </div>

            {/* Buy / Sell Direction Filter */}
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'LONG', label: 'Buy Only' },
                  { id: 'SHORT', label: 'Sell Only' },
                ] as Array<{ id: DirectionFilter; label: string }>
              ).map((opt) => {
                const active = uiPreferences.directionFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDirectionFilter(opt.id)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-white text-slate-900 shadow-sm font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Explicit Sort Mode Selector */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <span className="px-2 text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <ArrowDownUp className="h-3 w-3" />
                Sort:
              </span>
              {(
                [
                  { id: 'STATE', label: 'Higher TF ↓' },
                  { id: 'CLUSTER', label: 'S/R Levels ↓' },
                  { id: 'RISK', label: 'Risk to Didi ↑' },
                ] as Array<{ id: ScreenerSortKey; label: string }>
              ).map((sOpt) => {
                const active = activeSort === sOpt.id;
                return (
                  <button
                    key={sOpt.id}
                    type="button"
                    onClick={() => setSortBy(sOpt.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-slate-900 text-white shadow-sm font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    {sOpt.label}
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <Input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filter ticker or state..."
                className="h-7 pl-8 text-xs font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {scanError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Active Setups Spotlight Strip (Step 2 & Step 1) */}
      {topActiveSetups.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Setup Spotlight — Step 2 Confirmed &amp; Step 1 Wall
            </h2>
            <span className="text-[11px] text-slate-500">
              Click any card to open its 6-Pane ATS Charts
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {topActiveSetups.map((hit) => {
              const isSell = hit.setupSide === 'SELL';
              const badgeInfo = getStateBadgeStyle(hit.atsState, hit.setupSide);
              return (
                <button
                  key={hit.symbol}
                  type="button"
                  onClick={() => onSelectCandidate(hit.symbol, hit.category)}
                  className={cn(
                    'flex flex-col justify-between rounded-xl border p-3 text-left transition-all shadow-sm hover:-translate-y-0.5 bg-white',
                    hit.atsState === 'STEP 2: REVERSAL CONFIRMED'
                      ? isSell
                        ? 'border-rose-300 bg-rose-50/40 hover:border-rose-500'
                        : 'border-emerald-300 bg-emerald-50/40 hover:border-emerald-500'
                      : 'border-amber-300 bg-amber-50/40 hover:border-amber-500'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="font-mono text-sm font-bold text-slate-900 truncate">
                      {hit.displaySymbol}
                    </span>
                    <Badge
                      variant={isSell ? 'resistance' : 'support'}
                      className="text-[9px] px-1.5 py-0 font-mono"
                    >
                      {hit.setupSide}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {hit.bbExitTimeframe && hit.highestHtfTimeframe && (
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {hit.bbExitTimeframe} BB → {hit.highestHtfTimeframe}
                      </span>
                    )}
                    <Badge
                      variant={badgeInfo.variant}
                      className="text-[9px] px-1.5 py-0 font-mono font-bold"
                    >
                      {hit.atsState === 'STEP 2: REVERSAL CONFIRMED'
                        ? 'PHASE 3'
                        : 'PHASE 2'}
                    </Badge>
                  </div>

                  {hit.matchedHtfLevels && hit.matchedHtfLevels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {hit.matchedHtfLevels.slice(0, 2).map((lvl, idx) => (
                        <span
                          key={`${lvl.label}-${idx}`}
                          className="rounded border border-slate-200 bg-white/90 px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-700"
                        >
                          {lvl.label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-700 w-full">
                    <span className="font-bold">
                      {hit.ClusterDensityCount}{' '}
                      {hit.ClusterDensityCount === 1 ? 'Level' : 'Levels'}
                    </span>
                    <span className="text-rose-700 font-semibold">
                      Didi {hit.RiskToDidi.toFixed(2)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main ATS State Detection Table */}
      <Card className="overflow-hidden border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker &amp; Live Price</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => setSortBy('STATE')}
                  className="inline-flex items-center gap-1 font-semibold hover:text-slate-950"
                >
                  BB Exit → HTF S/R
                  {activeSort === 'STATE' && <span>↓</span>}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => setSortBy('CLUSTER')}
                  className="inline-flex items-center gap-1 font-semibold hover:text-slate-950"
                >
                  HTF S/R Levels (BB/SAR/MM/Jack/Oggy)
                  {activeSort === 'CLUSTER' && <span>↓</span>}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => setSortBy('RISK')}
                  className="inline-flex items-center gap-1 font-semibold hover:text-slate-950"
                >
                  Risk to Didi (%)
                  {activeSort === 'RISK' && <span>↑</span>}
                </button>
              </TableHead>
              <TableHead>
                Unbroken MTF Horizons (D · W · M · 3M · 6M · 12M)
              </TableHead>
              <TableHead className="text-right">Details / Charts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isScanning && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <TableRow key={idx} className="animate-pulse">
                  <TableCell colSpan={6} className="py-5">
                    <div className="h-5 w-full rounded bg-slate-100" />
                  </TableCell>
                </TableRow>
              ))
            ) : displayedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-slate-500"
                >
                  No assets match the current state filter. Switch to &ldquo;All
                  States&rdquo; to inspect every scanned ticker.
                </TableCell>
              </TableRow>
            ) : (
              displayedRows.map((row) => {
                const isPositive24h = row.change24hPct >= 0;
                const isExpanded = expandedSymbol === row.symbol;
                const isSell = row.setupSide === 'SELL';
                const isActive =
                  row.atsState === 'STEP 1: THE WALL' ||
                  row.atsState === 'STEP 2: REVERSAL CONFIRMED';
                const badgeInfo = getStateBadgeStyle(
                  row.atsState,
                  row.setupSide
                );

                return (
                  <React.Fragment key={row.symbol}>
                    <TableRow
                      onClick={() =>
                        onSelectCandidate(row.symbol, row.category)
                      }
                      className={cn(
                        'cursor-pointer group transition-colors',
                        row.atsState === 'STEP 2: REVERSAL CONFIRMED'
                          ? isSell
                            ? 'bg-rose-50/45 hover:bg-rose-50/80'
                            : 'bg-emerald-50/45 hover:bg-emerald-50/80'
                          : row.atsState === 'STEP 1: THE WALL'
                          ? 'bg-amber-50/40 hover:bg-amber-50/80'
                          : 'hover:bg-slate-50'
                      )}
                    >
                      {/* 1. Ticker & Live Price */}
                      <TableCell className="align-top">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                              {row.displaySymbol}
                            </span>
                            {isActive && (
                              <Badge
                                variant={isSell ? 'resistance' : 'support'}
                                className="text-[9px] px-1.5 py-0 font-mono"
                              >
                                {row.setupSide}
                              </Badge>
                            )}
                          </div>
                          {row.name && (
                            <p className="text-[11px] text-slate-500 truncate max-w-[140px]">
                              {row.name}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-1.5 font-mono text-xs">
                            <span className="text-slate-900 font-semibold">
                              {formatPrice(row.livePrice, row.category)}
                            </span>
                            <span
                              className={cn(
                                'text-[11px] font-semibold',
                                isPositive24h
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                              )}
                            >
                              {isPositive24h ? '+' : ''}
                              {row.change24hPct.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 2. Prominent BB Exit -> HTF S/R State Column */}
                      <TableCell className="align-top max-w-[300px]">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isActive &&
                              row.bbExitTimeframe &&
                              row.highestHtfTimeframe && (
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded px-2 py-0.5 font-mono text-[11px] font-extrabold text-white',
                                    isSell ? 'bg-rose-700' : 'bg-emerald-700'
                                  )}
                                >
                                  {row.bbExitTimeframe} BB →{' '}
                                  {row.highestHtfTimeframe}{' '}
                                  {isSell ? 'RES' : 'SUP'}
                                </span>
                              )}
                            <Badge
                              variant={badgeInfo.variant}
                              className="font-mono text-[10px] font-bold px-1.5 py-0.5"
                            >
                              {row.atsState}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-700 leading-snug line-clamp-2">
                            {row.thesisHeadline}
                          </p>
                        </div>
                      </TableCell>

                      {/* 3. Matched Higher-TF S/R Levels Column (SAR, MM7, MM20, Jack, Oggy) */}
                      <TableCell className="align-top">
                        <div className="space-y-1.5 font-mono">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-extrabold',
                                row.ClusterDensityCount >= 3
                                  ? 'border-emerald-400 bg-emerald-100 text-emerald-900'
                                  : row.ClusterDensityCount >= 1
                                  ? 'border-sky-300 bg-sky-50 text-sky-900'
                                  : 'border-slate-200 bg-slate-100 text-slate-500'
                              )}
                            >
                              {row.ClusterDensityCount}{' '}
                              {row.ClusterDensityCount === 1
                                ? 'Level'
                                : 'Levels'}
                            </span>
                          </div>
                          {row.matchedHtfLevels &&
                          row.matchedHtfLevels.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {row.matchedHtfLevels.slice(0, 4).map((lvl, idx) => (
                                <span
                                  key={`${lvl.label}-${idx}`}
                                  title={`${lvl.label} @ ${formatPrice(
                                    lvl.price,
                                    row.category
                                  )} (${lvl.distancePct.toFixed(2)}% away)`}
                                  className={cn(
                                    'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                                    lvl.kind === 'Oggy'
                                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                                      : lvl.kind === 'SAR'
                                      ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                                      : lvl.kind === 'MM7' ||
                                        lvl.kind === 'MM20'
                                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                                      : isSell
                                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                                      : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  )}
                                >
                                  {lvl.label}
                                </span>
                              ))}
                              {row.matchedHtfLevels.length > 4 && (
                                <span className="text-[10px] text-slate-500">
                                  +{row.matchedHtfLevels.length - 4}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500">
                              No HTF S/R match
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* 4. Risk to Didi (%) Column */}
                      <TableCell className="align-top">
                        <div className="space-y-1 font-mono text-xs min-w-[135px]">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'text-sm font-extrabold',
                                row.atsState === 'INVALIDATED'
                                  ? 'text-rose-700 line-through'
                                  : row.RiskToDidi <= 0.75
                                  ? 'text-emerald-700'
                                  : row.RiskToDidi <= 1.75
                                  ? 'text-amber-700'
                                  : 'text-slate-700'
                              )}
                            >
                              {row.RiskToDidi.toFixed(2)}%
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Didi:{' '}
                            <span className="font-semibold text-slate-800">
                              {formatPrice(row.didiPrice, row.category)}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 5. Unbroken MTF Horizons (Jack Green/Red + Oggy Blue) */}
                      <TableCell className="align-top">
                        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6 min-w-[250px]">
                          {ALL_TIMEFRAMES.map((tf) => {
                            const h = row.horizonMatrix[tf];
                            if (
                              !h ||
                              (h.greenCount === 0 && h.redCount === 0)
                            ) {
                              return (
                                <div
                                  key={tf}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-center font-mono text-[10px] text-slate-400"
                                >
                                  <div>{tf}</div>
                                  <div>—</div>
                                </div>
                              );
                            }

                            const hasTouch = h.wallTouches.length > 0;
                            const touchPolarity = h.wallTouches[0]?.polarity;
                            const hasOggyTouch = h.wallTouches.some(
                              (w) => w.family === 'Oggy'
                            );

                            return (
                              <div
                                key={tf}
                                title={`${tf} Unbroken Lines — Support (${
                                  h.greenCount
                                }): ${
                                  h.greenLines.join(', ') || 'None'
                                } | Resistance (${h.redCount}): ${
                                  h.redLines.join(', ') || 'None'
                                } | Blue Oggy: ${h.oggyCount}`}
                                className={cn(
                                  'rounded border px-1.5 py-1 text-center font-mono text-[10px] transition-colors',
                                  hasTouch
                                    ? hasOggyTouch
                                      ? 'border-blue-500 bg-blue-50 text-blue-950 ring-1 ring-blue-300'
                                      : touchPolarity === 'GREEN'
                                      ? 'border-emerald-500 bg-emerald-100 text-emerald-950 ring-1 ring-emerald-400'
                                      : 'border-rose-500 bg-rose-100 text-rose-950 ring-1 ring-rose-400'
                                    : 'border-slate-200 bg-white text-slate-800'
                                )}
                              >
                                <div className="font-bold text-[10px] flex items-center justify-center gap-0.5">
                                  <span>{tf}</span>
                                  {hasTouch && <span>★</span>}
                                </div>
                                <div className="text-[9px] tracking-tighter font-semibold">
                                  <span className="text-emerald-700">
                                    {h.greenCount}G
                                  </span>
                                  <span className="text-slate-300">/</span>
                                  <span className="text-rose-700">
                                    {h.redCount}R
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                          <span>{row.volatilitySignal}</span>
                        </div>
                      </TableCell>

                      {/* 6. Gatekeeper Details & Open Charts */}
                      <TableCell className="align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSymbol((prev) =>
                                prev === row.symbol ? null : row.symbol
                              );
                            }}
                          >
                            <Info className="h-3 w-3 text-sky-600" />
                            Checks
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-emerald-700 hover:text-emerald-900 px-2 text-xs font-semibold"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCandidate(row.symbol, row.category);
                            }}
                          >
                            Charts
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>

                          {currentPresetId === 'custom' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-rose-600"
                              title="Remove from custom watchlist"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTicker(row.symbol, row.category);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expandable Chronological State Gatekeeper Audit Drawer */}
                    {isExpanded && (
                      <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                        <TableCell
                          colSpan={6}
                          className="p-4 border-b border-slate-200"
                        >
                          <div className="space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                                  <span>
                                    Chronological State Audit —{' '}
                                    {row.displaySymbol}
                                  </span>
                                  <Badge
                                    variant={badgeInfo.variant}
                                    className="font-mono text-[10px]"
                                  >
                                    {row.atsState}
                                  </Badge>
                                  <span className="font-mono text-xs text-slate-600">
                                    ClusterDensityCount:{' '}
                                    <strong>{row.ClusterDensityCount}</strong> ·
                                    RiskToDidi:{' '}
                                    <strong>{row.RiskToDidi.toFixed(2)}%</strong>
                                  </span>
                                </h4>
                                <ul className="mt-2 space-y-1 text-xs text-slate-700 list-disc pl-5">
                                  {row.reasoningBullets.map((bullet, bIdx) => (
                                    <li key={bIdx}>{bullet}</li>
                                  ))}
                                </ul>
                              </div>

                              <Button
                                size="sm"
                                onClick={() =>
                                  onSelectCandidate(row.symbol, row.category)
                                }
                              >
                                Open 6-Pane ATS Charts
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>

        {filteredRows.length > visibleLimit && (
          <div className="flex items-center justify-center border-t border-slate-200 bg-slate-50 p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleLimit((prev) => prev + 60)}
            >
              Show More ({visibleLimit} of {filteredRows.length} assets shown)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};
