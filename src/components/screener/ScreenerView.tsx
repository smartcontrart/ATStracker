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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
}

const CATEGORY_PLACEHOLDERS: Record<AssetCategory, string> = {
  stocks: 'Add custom Stock/ETF (e.g., SNOW, ARM, SMCI)...',
  crypto: 'Add custom Crypto (e.g., HYPE, TAO, PEPE)...',
  forex: 'Add custom FX pair (e.g., EURPLN, USDNOK)...',
};

const BATCH_SIZE = 25;

export const ScreenerView: React.FC<ScreenerViewProps> = ({
  onSelectCandidate,
}) => {
  const {
    activeCategory,
    setActiveCategory,
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
        const curProgress = useATSStore.getState().scanProgress[activeCategory];
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

  return (
    <div className="space-y-5">
      {/* Header & Scan Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Top Candidates — Bidirectional ATS Screener
            </h1>
            <Badge variant="support" className="font-mono">
              SUPPORT &amp; RESISTANCE WALLS
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            Scans S&amp;P 500 equities, Top 100 Cryptos, and Top 50 USD/FX pairs for 1% Higher-Timeframe{' '}
            <span className="text-emerald-400 font-medium">Green Support (LONG)</span> &amp;{' '}
            <span className="text-rose-400 font-medium">Red Resistance (SHORT)</span> confluence. Click any row for 6-pane charts or{' '}
            <span className="text-slate-200 font-medium">&ldquo;Why?&rdquo;</span> for full indicator reasoning.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => triggerGlobalAssetLookup()}
          >
            <Search className="h-3.5 w-3.5" />
            Lookup Specific Asset (⌘K)
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
              Rescan Universe ({getActiveSymbolsForCategory(activeCategory).length})
            </Button>
          )}
        </div>
      </div>

      {/* Live Streaming Batch Progress Bar */}
      {isScanning && progress.total > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-emerald-300 font-semibold flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Streaming MTF Polarity Batches: {progress.completed} / {progress.total}{' '}
              assets ({progressPct}%)
            </span>
            <span className="text-slate-400">
              Live hits so far:{' '}
              <strong className="text-emerald-400">{supportWallsCount} Support</strong> ·{' '}
              <strong className="text-rose-400">{resistanceWallsCount} Resistance</strong>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-800/80 bg-slate-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                LONG • Green Support Walls
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-emerald-400">
                {supportWallsCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (&le;1% above floor)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800/80 bg-slate-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                SHORT • Red Resistance Walls
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-rose-400">
                {resistanceWallsCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  (&le;1% below ceiling)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-2.5 text-rose-400">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800/80 bg-slate-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Step 3–4 Vol. Confirmed
              </p>
              <p className="mt-1 text-2xl font-bold font-mono text-sky-300">
                {step3PlusCount}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / {rows.length} scanned
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2.5 text-sky-400">
              <Activity className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800/80 bg-slate-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Universe Coverage
              </p>
              <p className="mt-1 text-lg font-bold font-mono text-white">
                {rows.length} Assets Live
              </p>
              <p className="text-[11px] text-slate-500">
                {scannedTimestamp
                  ? `Last batch ${new Date(scannedTimestamp).toLocaleTimeString()}`
                  : 'Initializing...'}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-400">
              <Target className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category Tabs + Universe Preset Selector */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={activeCategory}
              onValueChange={(val) => {
                if (isScanning) stopActiveScan();
                setActiveCategory(val as AssetCategory);
              }}
              className="w-auto"
            >
              <TabsList>
                <TabsTrigger value="stocks">Stocks (S&amp;P 500)</TabsTrigger>
                <TabsTrigger value="crypto">Crypto (Top 100)</TabsTrigger>
                <TabsTrigger value="forex">Forex &amp; USD (Top 50)</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Universe Size Preset Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {presetsForCategory.map((preset) => {
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
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                        : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-slate-200'
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Custom Ticker */}
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

        {/* Direction Filter + <=1% Wall Toggle + Instant Filter Search */}
        <div className="flex flex-col gap-2 border-t border-slate-800/70 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
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
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
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
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
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
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Top Hit List Spotlight Strip (Highest Confidence Scores) */}
      {topHitLeaders.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top {activeCategory === 'stocks' ? 'Stock' : activeCategory === 'crypto' ? 'Crypto' : 'Forex'} Hit List — Ranked by Confidence Score
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
                    'flex flex-col justify-between rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5',
                    isShort && hit.isAtWall
                      ? 'border-rose-500/40 bg-rose-950/20 hover:border-rose-400'
                      : hit.direction === 'LONG' && hit.isAtWall
                      ? 'border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-400'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] text-slate-500">
                        #{idx + 1}
                      </span>
                      <span className="font-mono text-sm font-bold text-white truncate">
                        {hit.displaySymbol}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-xs font-extrabold shrink-0',
                        hit.confidenceScore >= 70
                          ? isShort
                            ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
                            : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                          : hit.confidenceScore >= 45
                          ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      )}
                    >
                      {hit.confidenceScore}%
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-200">
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

                  <div className="mt-1.5 truncate font-mono text-[10px] text-slate-400 w-full">
                    {hit.activeWallLabel}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main ATS Screener Table with Horizon Matrix & Expandable Reasoning */}
      <Card className="overflow-hidden border-slate-800/90">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker &amp; Price</TableHead>
              <TableHead>Setup, Active Wall &amp; Thesis</TableHead>
              <TableHead>MTF Polarity Horizons (D · W · M · 3M · 6M · 12M)</TableHead>
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
                    <div className="h-5 w-full rounded bg-slate-900" />
                  </TableCell>
                </TableRow>
              ))
            ) : displayedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-slate-400">
                  No matching candidates under the active filters. Try switching Direction to &ldquo;All Directions&rdquo; or disabling &ldquo;Active &le;1% Walls Only&rdquo;.
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
                      onClick={() => onSelectCandidate(row.symbol, row.category)}
                      className={cn(
                        'cursor-pointer group transition-colors',
                        row.direction === 'LONG' && row.isAtWall
                          ? 'bg-emerald-950/15 hover:bg-emerald-950/30'
                          : row.direction === 'SHORT' && row.isAtWall
                          ? 'bg-rose-950/15 hover:bg-rose-950/30'
                          : 'hover:bg-slate-900/80'
                      )}
                    >
                      {/* 1. Ticker & Live Price */}
                      <TableCell className="align-top">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                              {row.displaySymbol}
                            </span>
                            {row.isAtWall && (
                              <span
                                className={cn(
                                  'inline-block h-2 w-2 rounded-full',
                                  isShort
                                    ? 'bg-rose-400 shadow-[0_0_8px_#fb7185]'
                                    : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
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
                            <span className="text-slate-200 font-semibold">
                              {formatPrice(row.livePrice, row.category)}
                            </span>
                            <span
                              className={cn(
                                'text-[11px]',
                                isPositive24h ? 'text-emerald-400' : 'text-rose-400'
                              )}
                            >
                              {isPositive24h ? '+' : ''}
                              {row.change24hPct.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 2. Setup Direction, Active Wall & Candidate Thesis */}
                      <TableCell className="align-top max-w-[310px]">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.direction === 'LONG' ? (
                              <Badge variant="support" className="font-mono text-[10px]">
                                LONG • SUPPORT
                              </Badge>
                            ) : row.direction === 'SHORT' ? (
                              <Badge variant="resistance" className="font-mono text-[10px]">
                                SHORT • RESIST
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                NEUTRAL WATCH
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

                          <p className="text-xs text-slate-300 leading-snug">
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
                                  className="rounded border border-slate-800/80 bg-slate-950/60 px-1.5 py-1 text-center font-mono text-[10px] text-slate-600"
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
                                title={`${tf} Horizon — Green Supports (${h.greenCount}): ${
                                  h.greenLines.join(', ') || 'None'
                                } | Red Resistances (${h.redCount}): ${
                                  h.redLines.join(', ') || 'None'
                                } | BB: ${h.bbState} | SAR: ${h.sarState}`}
                                className={cn(
                                  'rounded border px-1.5 py-1 text-center font-mono text-[10px] transition-colors',
                                  hasTouch
                                    ? touchPolarity === 'GREEN'
                                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                                      : 'border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                                    : mostlyGreen
                                    ? 'border-emerald-500/30 bg-emerald-950/25 text-emerald-300'
                                    : mostlyRed
                                    ? 'border-rose-500/30 bg-rose-950/25 text-rose-300'
                                    : 'border-amber-500/30 bg-slate-900 text-amber-200'
                                )}
                              >
                                <div className="font-bold text-[10px] flex items-center justify-center gap-0.5">
                                  <span>{tf}</span>
                                  {hasTouch && <span>★</span>}
                                </div>
                                <div className="text-[9px] tracking-tighter">
                                  <span className="text-emerald-400">{h.greenCount}G</span>
                                  <span className="text-slate-500">/</span>
                                  <span className="text-rose-400">{h.redCount}R</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                          <span>{row.volatilitySignal}</span>
                          <span>·</span>
                          <span>D-SAR: {row.horizonMatrix.D?.sarState}</span>
                        </div>
                      </TableCell>

                      {/* 4. Confidence Score & Setup Step (1 to 4) */}
                      <TableCell className="align-top">
                        <div className="space-y-1.5 min-w-[155px]">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'font-mono text-sm font-bold',
                                row.confidenceScore >= 70
                                  ? 'text-emerald-400'
                                  : row.confidenceScore >= 45
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
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

                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                row.confidenceScore >= 70
                                  ? 'bg-emerald-400'
                                  : row.confidenceScore >= 45
                                  ? 'bg-amber-400'
                                  : 'bg-slate-500'
                              )}
                              style={{ width: `${row.confidenceScore}%` }}
                            />
                          </div>

                          <div className="flex items-center gap-1 text-[9px] font-mono">
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step1Wall
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : 'border-slate-800 text-slate-600'
                              )}
                            >
                              1:Wall
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step2Didi
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : 'border-slate-800 text-slate-600'
                              )}
                            >
                              2:Didi
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step3VolatilityReversal
                                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                                  : 'border-slate-800 text-slate-600'
                              )}
                            >
                              3:BB
                            </span>
                            <span
                              className={cn(
                                'rounded px-1 border',
                                row.stepFlags.step4MacroM20
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                  : 'border-slate-800 text-slate-600'
                              )}
                            >
                              4:M20
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 5. Stop Loss & TP1 (Didi) / TP2 (M20) */}
                      <TableCell className="align-top">
                        <div className="space-y-1 font-mono text-xs min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">SL:</span>
                            <span className="text-rose-400 font-semibold">
                              {formatPrice(row.stopLoss, row.category)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ({isShort ? '+1% wall' : '-1% wall'})
                            </span>
                          </div>

                          {row.effectiveTargetTP1 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-slate-500">TP1:</span>
                              <span className="text-emerald-300 font-semibold">
                                {formatPrice(
                                  row.effectiveTargetTP1.price,
                                  row.category
                                )}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ({row.effectiveTargetTP1.label})
                              </span>
                            </div>
                          ) : (
                            <div className="text-slate-500 text-[11px]">
                              TP1: Open Discovery
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
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
                              <span className="text-amber-300 font-semibold">
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
                            <Info className="h-3 w-3 text-sky-400" />
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
                            className="h-7 text-emerald-400 hover:text-emerald-300 px-2 text-xs"
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
                              className="h-7 w-7 text-slate-500 hover:text-rose-400"
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
                      <TableRow className="bg-slate-950/95 hover:bg-slate-950/95">
                        <TableCell colSpan={6} className="p-4 border-b border-slate-800">
                          <div className="space-y-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                  <span>
                                    ATS Quantitative Reasoning — {row.displaySymbol}
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
                                    {row.direction} SETUP ({row.confidenceScore}% CONFIDENCE)
                                  </Badge>
                                </h4>
                                <ul className="mt-2 space-y-1 text-xs text-slate-300 list-disc pl-5">
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

                            {/* Detailed 6-Timeframe Support & Resistance Indicator Breakdown */}
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                              {ALL_TIMEFRAMES.map((tf) => {
                                const h = row.horizonMatrix[tf];
                                return (
                                  <div
                                    key={tf}
                                    className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                                      <span className="font-mono font-bold text-white">
                                        {tf} Horizon
                                      </span>
                                      <span className="font-mono text-[10px]">
                                        <span className="text-emerald-400 font-semibold">
                                          {h.greenCount}G
                                        </span>{' '}
                                        /{' '}
                                        <span className="text-rose-400 font-semibold">
                                          {h.redCount}R
                                        </span>
                                      </span>
                                    </div>

                                    {h.wallTouches.length > 0 && (
                                      <div className="rounded bg-slate-950/90 px-1.5 py-1 font-mono text-[10px]">
                                        <span className="text-amber-300 font-semibold">
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
                                      <span className="text-emerald-400 font-semibold">
                                        Supports:{' '}
                                      </span>
                                      <span className="font-mono text-slate-300">
                                        {h.greenLines.length > 0
                                          ? h.greenLines.join(', ')
                                          : 'None'}
                                      </span>
                                    </div>

                                    <div className="text-[11px]">
                                      <span className="text-rose-400 font-semibold">
                                        Resistances:{' '}
                                      </span>
                                      <span className="font-mono text-slate-300">
                                        {h.redLines.length > 0
                                          ? h.redLines.join(', ')
                                          : 'None'}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/70 font-mono text-[10px] text-slate-400">
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
          <div className="flex items-center justify-center border-t border-slate-800 p-3 bg-slate-950/70">
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
