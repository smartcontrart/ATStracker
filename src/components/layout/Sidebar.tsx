'use client';

import React, { useMemo } from 'react';
import { BarChart3, Compass, Loader2, Radar, Zap } from 'lucide-react';
import { GlobalAssetLookup } from '@/components/search/GlobalAssetLookup';
import { Badge } from '@/components/ui/badge';
import { MarketToggle } from '@/components/ui/market-toggle';
import { compareScreenerResults } from '@/lib/atsScreener';
import { cn } from '@/lib/utils';
import { type ActiveDashboardView, useATSStore } from '@/store/useATSStore';
import type { AssetCategory, AtsState } from '@/types/ats';

interface SidebarProps {
  onNavigateView: (view: ActiveDashboardView) => void;
  onSelectAsset: (symbol: string, category: AssetCategory) => void;
  onSwitchCategory: (category: AssetCategory) => void;
}

const CATEGORY_HIT_TITLES: Record<AssetCategory, string> = {
  stocks: 'Top Stock Setups',
  crypto: 'Top Crypto Setups',
  forex: 'Top FX Setups',
};

function shortStateTag(state: AtsState | null, density: number): string {
  if (!state) return '—';
  if (state === 'STEP 2: REVERSAL CONFIRMED') return `STEP 2 · ${density}L`;
  if (state === 'STEP 1: THE WALL') return `STEP 1 · ${density}L`;
  if (state === 'INVALIDATED') return 'INVAL';
  return density > 0 ? `${density}L` : 'NONE';
}

export const Sidebar: React.FC<SidebarProps> = ({
  onNavigateView,
  onSelectAsset,
  onSwitchCategory,
}) => {
  const {
    activeView,
    activeCategory,
    selectedAsset,
    watchlists,
    screenerResults,
    screenerLoading,
    uiPreferences,
  } = useATSStore();

  const countActiveSetups = (list: typeof screenerResults.stocks) =>
    list.filter(
      (r) =>
        r.atsState === 'STEP 1: THE WALL' ||
        r.atsState === 'STEP 2: REVERSAL CONFIRMED'
    ).length;

  const totalActiveSetups =
    countActiveSetups(screenerResults.stocks) +
    countActiveSetups(screenerResults.crypto) +
    countActiveSetups(screenerResults.forex);

  const selectedAssetState = useMemo(() => {
    const found = screenerResults[selectedAsset.category].find(
      (r) => r.symbol === selectedAsset.symbol
    );
    return found
      ? shortStateTag(found.atsState, found.ClusterDensityCount)
      : null;
  }, [screenerResults, selectedAsset.category, selectedAsset.symbol]);

  const sidebarItems = useMemo(() => {
    const scanned = [...screenerResults[activeCategory]].sort((a, b) =>
      compareScreenerResults(a, b, uiPreferences.sortBy || 'STATE')
    );
    if (scanned.length > 0) {
      return scanned.slice(0, 25).map((r) => ({
        symbol: r.symbol,
        displaySymbol: r.displaySymbol,
        atsState: r.atsState as AtsState | null,
        density: r.ClusterDensityCount,
        riskToDidi: r.RiskToDidi,
        direction: r.direction,
        wallLabel: r.activeWallLabel,
      }));
    }
    return watchlists[activeCategory].slice(0, 20).map((sym) => ({
      symbol: sym,
      displaySymbol: sym.replace(/=X$/, ''),
      atsState: null as AtsState | null,
      density: 0,
      riskToDidi: 0,
      direction: 'NEUTRAL' as const,
      wallLabel: '',
    }));
  }, [activeCategory, screenerResults, uiPreferences.sortBy, watchlists]);

  return (
    <aside className="flex w-full flex-col border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 xl:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
      {/* Brand Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold tracking-wider text-slate-900">
                ATS ENGINE
              </span>
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                STATE
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Action Trading System</p>
          </div>
        </div>
      </div>

      {/* Always-Visible 1-Click Market Toggle (Stocks | Crypto | FX) + Lookup */}
      <div className="border-b border-slate-200 px-3 py-2.5 space-y-2 bg-slate-50/50">
        <MarketToggle
          value={activeCategory}
          onChange={onSwitchCategory}
          size="sm"
          fullWidth
        />
        <GlobalAssetLookup onSelectForCharts={onSelectAsset} />
      </div>

      {/* Primary View Navigation */}
      <nav className="p-3 space-y-1.5">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Workspace Views
        </p>

        <button
          type="button"
          onClick={() => onNavigateView('screener')}
          className={cn(
            'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all border',
            activeView === 'screener'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm font-semibold'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-transparent'
          )}
        >
          <span className="flex items-center gap-2.5">
            <Radar className="h-4 w-4" />
            <span>ATS State Screener</span>
          </span>
          {totalActiveSetups > 0 && (
            <Badge
              variant="support"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {totalActiveSetups}
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => onNavigateView('charts')}
          className={cn(
            'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all border',
            activeView === 'charts'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm font-semibold'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-transparent'
          )}
        >
          <span className="flex items-center gap-2.5">
            <BarChart3 className="h-4 w-4" />
            <span>6-Pane ATS Charts</span>
          </span>
          <span className="flex items-center gap-1 font-mono text-[11px] text-slate-700">
            <span>{selectedAsset.symbol.replace(/=X$/, '')}</span>
            {selectedAssetState && (
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-800 font-bold">
                {selectedAssetState}
              </span>
            )}
          </span>
        </button>
      </nav>

      {/* Ranked Active Setups List */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col border-t border-slate-200 p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <Compass className="h-3 w-3 text-emerald-600" />
            {CATEGORY_HIT_TITLES[activeCategory]}
          </span>
          <span className="text-[10px] font-mono text-slate-400">State</span>
        </div>

        <div className="space-y-1">
          {sidebarItems.map((item, idx) => {
            const isCurrent =
              activeView === 'charts' &&
              selectedAsset.symbol === item.symbol &&
              selectedAsset.category === activeCategory;

            const badgeClass =
              item.atsState === 'STEP 2: REVERSAL CONFIRMED'
                ? item.direction === 'SHORT'
                  ? 'border-rose-300 bg-rose-50 text-rose-800'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : item.atsState === 'STEP 1: THE WALL'
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : item.atsState === 'INVALIDATED'
                ? 'border-rose-200 bg-rose-50/50 text-rose-600 line-through'
                : 'border-slate-200 bg-slate-100 text-slate-500';

            return (
              <button
                key={item.symbol}
                type="button"
                title={
                  item.atsState
                    ? `${item.displaySymbol} — ${item.atsState} • ${item.density} line(s) • Risk to Didi: ${item.riskToDidi.toFixed(2)}%`
                    : `${item.displaySymbol} — Awaiting scan...`
                }
                onClick={() => onSelectAsset(item.symbol, activeCategory)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-mono transition-colors border',
                  isCurrent
                    ? 'border-emerald-400 bg-emerald-50/70 text-slate-950 font-bold'
                    : 'border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                )}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className="w-4 text-[10px] text-slate-400 text-right">
                    {idx + 1}.
                  </span>
                  {item.direction === 'LONG' &&
                    (item.atsState === 'STEP 1: THE WALL' ||
                      item.atsState === 'STEP 2: REVERSAL CONFIRMED') && (
                      <span className="rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-800">
                        B
                      </span>
                    )}
                  {item.direction === 'SHORT' &&
                    (item.atsState === 'STEP 1: THE WALL' ||
                      item.atsState === 'STEP 2: REVERSAL CONFIRMED') && (
                      <span className="rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-800">
                        S
                      </span>
                    )}
                  <span className="truncate">{item.displaySymbol}</span>
                </span>

                {item.atsState !== null ? (
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[9px] font-bold shrink-0',
                      badgeClass
                    )}
                  >
                    {shortStateTag(item.atsState, item.density)}
                  </span>
                ) : screenerLoading[activeCategory] ? (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400 shrink-0" />
                ) : (
                  <span className="text-[10px] text-slate-400">—</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer Info */}
      <div className="hidden lg:block border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">
        <div className="flex items-center justify-between">
          <span>Horizons</span>
          <span className="font-mono text-slate-700 font-medium">
            D · W · M / 12M · 6M · 3M
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>Colors</span>
          <span className="font-mono text-slate-700 font-medium">
            Jack G/R · Oggy Blue
          </span>
        </div>
      </div>
    </aside>
  );
};
