'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Filter,
  Info,
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
import { cn, formatPrice } from '@/lib/utils';
import { type DirectionFilter, useATSStore } from '@/store/useATSStore';
import {
  ALL_TIMEFRAMES,
  type AssetCategory,
  type ScreenerResult,
} from '@/types/ats';

interface ScreenerViewProps {
  onSelectCandidate: (symbol: string, category: AssetCategory) => void;
  onSwitchCategory: (category: AssetCategory) => void;
}

const CATEGORY_PLACEHOLDERS: Record<AssetCategory, string> = {
  stocks: 'Add custom Stock/ETF (e.g., SNOW, ARM, SMCI)...',
  crypto: 'Add custom Crypto (e.g., HYPE, TAO, PEPE)...',
  forex: 'Add custom FX pair (e.g., EURPLN, USDNOK)...',
};

const BATCH_SIZE = 25;

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
    toggleUIPreference,
    setDirectionFilter,
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
              ? `Note: ${failedSymbols.length} symbol(s) unavailable on free feed (${failedSymbols
                  .slice(0, 6)
                  .join(', ')}${failedSymbols.length > 6 ? '...' : ''}).`
              : null;
          finishCategoryScan(category, warnMsg);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : 'Progressive scan interrupted';
        finishCategoryScan(category, msg);
      }
    },
    [appendScreenerBatch, finishCategoryScan, startCategoryScan]
  );

  const currentPresetId = universePreset[activeCategory];

  useEffect(() => {
    setVisibleLimit(60);
    const existing = useATSStore.getState().screenerResults[activeCategory];
    const isLoading = useATSStore.getState().screenerLoading[activeCategory];

    if (!isLoading && existing.length === 0) {
      const targetSymbols = getActiveSymbolsForCategory(activeCategory);
      void runProgressiveUniverseScan(activeCategory, targetSymbols);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, currentPresetId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleAddSingleTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerInput.trim()) return;

    const rawTokens = tickerInput
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    setTickerInput('');

    const addedList: string[] = [];
    for (const token of rawTokens) {
      const added = addTicker(token, activeCategory);
      if (added) addedList.push(added);
    }
    if (addedList.length === 0) return;

    try {
      for (let i = 0; i < addedList.length; i += 25) {
        const chunk = addedList.slice(i, i + 25);
        const qs = new URLSearchParams({
          category: activeCategory,
          symbols: chunk.join(','),
        });
        const res = await fetch(`/api/screener?${qs.toString()}`);
        if (res.ok) {
          const json = await res.json();
          const curProgress =
            useATSStore.getState().scanProgress[activeCategory];
          appendScreenerBatch(
            activeCategory,
            (json.results || []) as ScreenerResult[],
            curProgress.completed + chunk.length,
            curProgress.total + chunk.length
          );
        }
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

  const supportWallsCount = useMemo(
    () => rows.filter((r) => r.direction === 'LONG' && r.isAtWall).length,
    [rows]
  );
  const resistanceWallsCount = useMemo(
    () => rows.filter((r) => r.direction === 'SHORT' && r.isAtWall).length,
    [rows]
  );
  const step3PlusCount = useMemo(
    () => rows.filter((r) => r.setupStep >= 3).length,
    [rows]
  );

  const topHitLeaders = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, 6),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const query = tableSearch.trim().toUpperCase();
    return rows.filter((r) => {
      if (uiPreferences.onlyWallCandidates && !r.isAtWall) return false;
      if (
        uiPreferences.directionFilter === 'LONG' &&
        r.direction !== 'LONG'
      ) {
        return false;
      }
      if (
        uiPreferences.directionFilter === 'SHORT' &&
        r.direction !== 'SHORT'
      ) {
        return false;
      }
      if (query) {
        const hay = `${r.symbol} ${r.displaySymbol} ${r.name || ''} ${
          r.activeWallLabel
        } ${r.thesisHeadline}`.toUpperCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [
    rows,
    tableSearch,
    uiPreferences.directionFilter,
    uiPreferences.onlyWallCandidates,
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
              Top Candidates — Bidirectional ATS Screener
            </h1>
            <Badge variant="support" className="font-mono">
              SUPPORT &amp; RESISTANCE WALLS
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            Scans S&amp;P 500 equities, Top 100 Cryptos, and Top 50 USD/FX pairs
            for 1% Higher-Timeframe{' '}
            <span className="text-emerald-700 font-semibold">
              Green Support (LONG)
            </span>{' '}
            &amp;{' '}
            <span className="text-rose-700 font-semibold">
              Red Resistance (SHORT)
            </span>{' '}
            confluence. Click any row for 6-pane OHLC bar charts or{' '}
            <span className="text-slate-900 font-semibold">&ldquo;Why?&rdquo;</span>{' '}
            for full indicator reasoning.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <MarketToggle
            value={activeCategory}
            onChange={(cat) => {
              if (isScanning) stopActiveScan();
              onSwitchCategory(cat);
            }}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerGlobalAssetLookup()}
          >
            <Search className="h-3.5 w-3.5 text-emerald-600" />
            Lookup Asset (⌘K)
          </Button>

          {isScanning ? (
            <Button variant="destructive" size="sm" onClick={stopActiveScan}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop ({progress.completed}/{progress.total})
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
              Streaming MTF Polarity Batches: {progress.completed} /{' '}
              {progress.total} assets ({progressPct}%)
            </span>
            <span className="text-slate-600">
              Live hits so far:{' '}
              <strong className="text-emerald-700">
                {supportWallsCount} Support
              </strong>{' '}
              ·{' '}
              <strong className="text-rose-700">
                {resistanceWallsCount} Resistance
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
                LONG • Green Support Walls
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-emerald-700">
                {supportWallsCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (&le;1% above floor)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-700">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                SHORT • Red Resistance Walls
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-rose-700">
                {resistanceWallsCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (&le;1% below ceiling)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-rose-700">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Step 3–4 Vol. Confirmed
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-sky-700">
                {step3PlusCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {rows.length} scanned
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-2.5 text-sky-700">
              <Activity className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Universe Coverage
              </p>
              <p className="mt-1 text-lg font-bold font-mono text-slate-900">
                {rows.length} Assets Live
              </p>
              <p className="text-[11px] text-slate-500">
                {scannedTimestamp
                  ? `Last batch ${new Date(scannedTimestamp).toLocaleTimeString()}`
                  : 'Initializing...'}
              </p>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-amber-700">
              <Target className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Universe Preset Selector + Custom Ticker Input */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 mr-1">
              Univers:
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

        {/* Direction Filter + <=1% Wall Toggle + Instant Filter Search */}
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'ALL', label: 'All Directions' },
                { id: 'LONG', label: 'LONG • Green Support' },
                { id: 'SHORT', label: 'SHORT • Red Resistance' },
              ] as Array<{ id: DirectionFilter; label: string }>
            ).map((opt) => {
              const isSelected = uiPreferences.directionFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDirectionFilter(opt.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors',
                    isSelected
                      ? opt.id === 'SHORT'
                        ? 'border-rose-400 bg-rose-50 text-rose-800'
                        : 'border-emerald-400 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}

            <Button
              variant={uiPreferences.onlyWallCandidates ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => toggleUIPreference('onlyWallCandidates')}
            >
              <Filter className="h-3 w-3" />
              {uiPreferences.onlyWallCandidates
                ? 'Active <=1% Walls Only'
                : 'Showing All Distances'}
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Filter scanned results..."
              className="h-7 pl-8 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {scanError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Top Hit List Spotlight Strip */}
      {topHitLeaders.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Top{' '}
              {activeCategory === 'stocks'
                ? 'Stock'
                : activeCategory === 'crypto'
                ? 'Crypto'
                : 'Forex'}{' '}
              Hit List — Ranked by Confidence Score
            </h2>
            <span className="text-[11px] text-slate-500">
              Click any card to open its 6-Pane ATS Charts
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {topHitLeaders.map((hit, idx) => {
              const isShort = hit.direction === 'SHORT';
              return (
                <button
                  key={hit.symbol}
                  type="button"
                  onClick={() => onSelectCandidate(hit.symbol, hit.category)}
                  className={cn(
                    'flex flex-col justify-between rounded-xl border p-3 text-left transition-all shadow-sm hover:-translate-y-0.5 bg-white',
                    isShort && hit.isAtWall
                      ? 'border-rose-300 bg-rose-50/40 hover:border-rose-500'
                      : hit.direction === 'LONG' && hit.isAtWall
                      ? 'border-emerald-300 bg-emerald-50/40 hover:border-emerald-500'
                      : 'border-slate-200 hover:border-slate-400'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] text-slate-400">
                        #{idx + 1}
                      </span>
                      <span className="font-mono text-sm font-bold text-slate-900 truncate">
                        {hit.displaySymbol}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-xs font-extrabold shrink-0',
                        hit.confidenceScore >= 70
                          ? isShort
                            ? 'border-rose-300 bg-rose-100 text-rose-800'
                            : 'border-emerald-300 bg-emerald-100 text-emerald-800'
                          : hit.confidenceScore >= 45
                          ? 'border-amber-300 bg-amber-100 text-amber-800'
                          : 'border-slate-200 bg-slate-100 text-slate-700'
                      )}
                    >
                      {hit.confidenceScore}%
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-800 font-semibold">
                      {formatPrice(hit.livePrice, hit.category)}
                    </span>
                    <Badge
                      variant={
                        isShort
                          ? 'resistance'
                          : hit.direction === 'LONG'
                          ? 'support'
                          : 'outline'
                      }
                      className="text-[9px] px-1.5 py-0"
                    >
                      {hit.direction}
                    </Badge>
                  </div>

                  <div className="mt-1.5 truncate font-mono text-[10px] text-slate-500 w-full">
                    {hit.activeWallLabel}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main ATS Screener Table */}
      <Card className="overflow-hidden border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker &amp; Price</TableHead>
              <TableHead>Setup, Active Wall &amp; Thesis</TableHead>
              <TableHead>
                MTF Polarity Horizons (D · W · M · 3M · 6M · 12M)
              </TableHead>
              <TableHead>Confidence &amp; Steps</TableHead>
              <TableHead>SL &amp; Didi Targets</TableHead>
              <TableHead className="text-right">Explain / Charts</TableHead>
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
                  No matching candidates under the active filters. Try switching
                  Direction to &ldquo;All Directions&rdquo; or disabling
                  &ldquo;Active &le;1% Walls Only&rdquo;.
                </TableCell>
              </TableRow>
            ) : (
              displayedRows.map((row) => {
                const isPositive24h = row.change24hPct >= 0;
                const isExpanded = expandedSymbol === row.symbol;
                const isShort = row.direction === 'SHORT';

                return (
                  <React.Fragment key={row.symbol}>
                    <TableRow
                      onClick={() =>
                        onSelectCandidate(row.symbol, row.category)
                      }
                      className={cn(
                        'cursor-pointer group transition-colors',
                        row.direction === 'LONG' && row.isAtWall
                          ? 'bg-emerald-50/40 hover:bg-emerald-50/80'
                          : row.direction === 'SHORT' && row.isAtWall
                          ? 'bg-rose-50/40 hover:bg-rose-50/80'
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
                            {row.isAtWall && (
                              <span
                                className={cn(
                                  'inline-block h-2 w-2 rounded-full',
                                  isShort ? 'bg-rose-600' : 'bg-emerald-600'
                                )}
                              />
                            )}
                          </div>
                          {row.name && (
                            <p className="text-[11px] text-slate-500 truncate max-w-[135px]">
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

                      {/* 2. Setup Direction, Signal Status (Orange vs Vert/Rouge) & Thesis */}
                      <TableCell className="align-top max-w-[320px]">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.signalStatus === 'CONFIRMED' ? (
                              <Badge
                                variant={isShort ? 'resistance' : 'support'}
                                className="font-mono text-[10px]"
                              >
                                {isShort
                                  ? '● SIGNAL ROUGE CONFIRMÉ'
                                  : '● SIGNAL VERT CONFIRMÉ'}
                              </Badge>
                            ) : row.signalStatus === 'CANDIDATE' ? (
                              <Badge
                                variant="amber"
                                className="font-mono text-[10px]"
                              >
                                ● SIGNAL ORANGE (Candidat)
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                SURVEILLANCE
                              </Badge>
                            )}

                            <Badge
                              variant={
                                row.isAtWall
                                  ? isShort
                                    ? 'resistance'
                                    : 'support'
                                  : 'outline'
                              }
                              className="font-mono text-xs"
                            >
                              {row.activeWallLabel}
                            </Badge>
                          </div>

                          <p className="text-xs text-slate-700 leading-snug">
                            {row.thesisHeadline}
                          </p>
                        </div>
                      </TableCell>

                      {/* 3. Multi-Horizon Indicator Matrix (D, W, M, 3M, 6M, 12M) */}
                      <TableCell className="align-top">
                        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6 min-w-[250px]">
                          {ALL_TIMEFRAMES.map((tf) => {
                            const h = row.horizonMatrix[tf];
                            if (!h || (h.greenCount === 0 && h.redCount === 0)) {
                              return (
                                <div
                                  key={tf}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-center font-mono text-[10px] text-slate-400"
                                >
                                  <div>{tf}</div>
                                  <div>N/A</div>
                                </div>
                              );
                            }

                            const hasTouch = h.wallTouches.length > 0;
                            const touchPolarity = h.wallTouches[0]?.polarity;
                            const mostlyGreen = h.greenCount > h.redCount;
                            const mostlyRed = h.redCount > h.greenCount;

                            return (
                              <div
                                key={tf}
                                title={`${tf} Horizon — Green Supports (${
                                  h.greenCount
                                }): ${
                                  h.greenLines.join(', ') || 'None'
                                } | Red Resistances (${h.redCount}): ${
                                  h.redLines.join(', ') || 'None'
                                } | BB: ${h.bbState} | SAR: ${h.sarState}`}
                                className={cn(
                                  'rounded border px-1.5 py-1 text-center font-mono text-[10px] transition-colors',
                                  hasTouch
                                    ? touchPolarity === 'GREEN'
                                      ? 'border-emerald-500 bg-emerald-100 text-emerald-950 ring-1 ring-emerald-400'
                                      : 'border-rose-500 bg-rose-100 text-rose-950 ring-1 ring-rose-400'
                                    : mostlyGreen
                                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                                    : mostlyRed
                                    ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                                    : 'border-amber-200 bg-amber-50/70 text-amber-900'
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
                                  <span className="text-slate-400">/</span>
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
                          <span>·</span>
                          <span>D-SAR: {row.horizonMatrix.D?.sarState}</span>
                        </div>
                      </TableCell>

                      {/* 4. Confidence Score & Setup Step */}
                      <TableCell className="align-top">
                        <div className="space-y-1.5 min-w-[155px]">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'font-mono text-sm font-bold',
                                row.confidenceScore >= 70
                                  ? isShort
                                    ? 'text-rose-700'
                                    : 'text-emerald-700'
                                  : row.confidenceScore >= 45
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                              )}
                            >
                              {row.confidenceScore}%
                            </span>
                            <Badge
                              variant={
                                row.setupStep >= 3
                                  ? 'support'
                                  : row.setupStep >= 1
                                  ? 'amber'
                                  : 'outline'
                              }
                              className="text-[10px] px-1.5 py-0"
                            >
                              {row.setupStep > 0
                                ? `STEP ${row.setupStep}/4`
                                : 'WATCH'}
                            </Badge>
                          </div>

                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                row.confidenceScore >= 70
                                  ? isShort
                                    ? 'bg-rose-600'
                                    : 'bg-emerald-600'
                                  : row.confidenceScore >= 45
                                  ? 'bg-amber-500'
                                  : 'bg-slate-400'
                              )}
                              style={{ width: `${row.confidenceScore}%` }}
                            />
                          </div>

                          <div className="flex items-center gap-1 text-[9px] font-mono font-semibold">
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step1Wall
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 text-slate-400'
                              )}
                            >
                              1:Macro
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step2Didi
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 text-slate-400'
                              )}
                            >
                              2:DeeDee
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step3VolatilityReversal
                                  ? 'border-sky-300 bg-sky-50 text-sky-800'
                                  : 'border-slate-200 text-slate-400'
                              )}
                            >
                              3:Phase3
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step4MacroM20
                                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                                  : 'border-slate-200 text-slate-400'
                              )}
                            >
                              4:M20
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 5. Stop Loss & Didi Targets */}
                      <TableCell className="align-top">
                        <div className="space-y-1 font-mono text-xs min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">SL:</span>
                            <span className="text-rose-700 font-bold">
                              {formatPrice(row.stopLoss, row.category)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ({isShort ? '+1% wall' : '-1% wall'})
                            </span>
                          </div>

                          {row.effectiveTargetTP1 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-slate-500">TP1:</span>
                              <span className="text-emerald-700 font-bold">
                                {formatPrice(
                                  row.effectiveTargetTP1.price,
                                  row.category
                                )}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                ({row.effectiveTargetTP1.label})
                              </span>
                            </div>
                          ) : (
                            <div className="text-slate-400 text-[11px]">
                              TP1: Open Discovery
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            {row.macroTargetTP2 && (
                              <span>
                                TP2: {row.macroTargetTP2.label} (
                                {formatPrice(
                                  row.macroTargetTP2.price,
                                  row.category
                                )}
                                )
                              </span>
                            )}
                            {row.riskRewardRatio !== null && (
                              <span className="text-amber-700 font-bold">
                                {row.riskRewardRatio.toFixed(2)}x R:R
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      {/* 6. Explain Reasoning Toggle + Open Charts */}
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
                            Why?
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

                    {/* Expandable Quantitative Reasoning & 6-Horizon Indicator Drawer */}
                    {isExpanded && (
                      <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                        <TableCell
                          colSpan={6}
                          className="p-4 border-b border-slate-200"
                        >
                          <div className="space-y-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                  <span>
                                    ATS Quantitative Reasoning —{' '}
                                    {row.displaySymbol}
                                  </span>
                                  <Badge
                                    variant={
                                      row.direction === 'SHORT'
                                        ? 'resistance'
                                        : row.direction === 'LONG'
                                        ? 'support'
                                        : 'outline'
                                    }
                                    className="font-mono text-[10px]"
                                  >
                                    {row.direction} SETUP ({row.confidenceScore}
                                    % CONFIDENCE)
                                  </Badge>
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
                                className="shrink-0"
                              >
                                Open 6-Pane ATS Charts
                                <ArrowUpRight className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                              {ALL_TIMEFRAMES.map((tf) => {
                                const h = row.horizonMatrix[tf];
                                return (
                                  <div
                                    key={tf}
                                    className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1.5 text-xs shadow-sm"
                                  >
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                                      <span className="font-mono font-bold text-slate-900">
                                        {tf} Horizon
                                      </span>
                                      <span className="font-mono text-[10px] font-semibold">
                                        <span className="text-emerald-700">
                                          {h.greenCount}G
                                        </span>{' '}
                                        /{' '}
                                        <span className="text-rose-700">
                                          {h.redCount}R
                                        </span>
                                      </span>
                                    </div>

                                    {h.wallTouches.length > 0 && (
                                      <div className="rounded bg-amber-50 border border-amber-200 px-1.5 py-1 font-mono text-[10px] text-amber-900">
                                        <span className="font-bold">
                                          ★ Wall Touch (&le;1%):{' '}
                                        </span>
                                        {h.wallTouches
                                          .map(
                                            (w) =>
                                              `${w.shortName} (${w.absDistancePct.toFixed(
                                                2
                                              )}%)`
                                          )
                                          .join(', ')}
                                      </div>
                                    )}

                                    <div className="text-[11px]">
                                      <span className="text-emerald-700 font-semibold">
                                        Supports:{' '}
                                      </span>
                                      <span className="font-mono text-slate-700">
                                        {h.greenLines.length > 0
                                          ? h.greenLines.join(', ')
                                          : 'None'}
                                      </span>
                                    </div>

                                    <div className="text-[11px]">
                                      <span className="text-rose-700 font-semibold">
                                        Resistances:{' '}
                                      </span>
                                      <span className="font-mono text-slate-700">
                                        {h.redLines.length > 0
                                          ? h.redLines.join(', ')
                                          : 'None'}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 font-mono text-[10px] text-slate-500">
                                      <span>BB: {h.bbState}</span>
                                      <span>SAR: {h.sarState}</span>
                                    </div>
                                  </div>
                                );
                              })}
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
          <div className="flex items-center justify-center border-t border-slate-200 p-3 bg-slate-50">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleLimit((prev) => prev + 100)}
            >
              Show More ({visibleLimit} of {filteredRows.length} shown)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};
