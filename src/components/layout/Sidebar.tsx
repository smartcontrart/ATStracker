'use client';

import React, { useMemo } from 'react';
import {
  BarChart3,
  BookOpen,
  Compass,
  Layers,
  Loader2,
  Radar,
  Zap,
} from 'lucide-react';
import { GlobalAssetLookup } from '@/components/search/GlobalAssetLookup';
import { Badge } from '@/components/ui/badge';
import { MarketToggle } from '@/components/ui/market-toggle';
import { resolveExecutionModeResult } from '@/lib/atsScreener';
import { cn } from '@/lib/utils';
import { type ActiveDashboardView, useATSStore } from '@/store/useATSStore';
import type { AssetCategory } from '@/types/ats';

interface SidebarProps {
  onNavigateView: (view: ActiveDashboardView) => void;
  onSelectAsset: (symbol: string, category: AssetCategory) => void;
  onSwitchCategory: (category: AssetCategory) => void;
}

const CATEGORY_HIT_TITLES: Record<AssetCategory, string> = {
  stocks: 'Top Stock Hit List',
  crypto: 'Top Crypto Hit List',
  forex: 'Top Forex Hit List',
};

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

  const requirePhase3 = Boolean(uiPreferences.requirePhase3Confirmation);

  const countActionable = (list: typeof screenerResults.stocks) =>
    list.filter(
      (r) => resolveExecutionModeResult(r, requirePhase3).finalScore >= 70
    ).length;

  const totalWallHits =
    countActionable(screenerResults.stocks) +
    countActionable(screenerResults.crypto) +
    countActionable(screenerResults.forex);

  const selectedAssetScore = useMemo(() => {
    const found = screenerResults[selectedAsset.category].find(
      (r) => r.symbol === selectedAsset.symbol
    );
    return found
      ? resolveExecutionModeResult(found, requirePhase3).finalScore
      : null;
  }, [requirePhase3, screenerResults, selectedAsset.category, selectedAsset.symbol]);

  const sidebarItems = useMemo(() => {
    const scanned = [...screenerResults[activeCategory]].sort(
      (a, b) =>
        resolveExecutionModeResult(b, requirePhase3).finalScore -
        resolveExecutionModeResult(a, requirePhase3).finalScore
    );
    if (scanned.length > 0) {
      return scanned.slice(0, 25).map((r) => {
        const modeRes = resolveExecutionModeResult(r, requirePhase3);
        return {
          symbol: r.symbol,
          displaySymbol: r.displaySymbol,
          score: modeRes.finalScore,
          tradeAction: modeRes.tradeAction,
          isAtWall: r.isAtWall,
          direction: r.direction,
          wallLabel: r.activeWallLabel,
        };
      });
    }
    return watchlists[activeCategory].slice(0, 20).map((sym) => ({
      symbol: sym,
      displaySymbol: sym.replace(/=X$/, ''),
      score: null as number | null,
      tradeAction: 'WATCHLIST' as const,
      isAtWall: false,
      direction: 'NEUTRAL' as const,
      wallLabel: '',
    }));
  }, [activeCategory, requirePhase3, screenerResults, watchlists]);

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
                MTF
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
            <span>Top Candidates</span>
          </span>
          {totalWallHits > 0 && (
            <Badge
              variant="support"
              className="px-1.5 py-0 text-[10px] font-mono"
            >
              {totalWallHits}
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
            {selectedAssetScore !== null && (
              <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] text-emerald-800 font-bold">
                {selectedAssetScore}%
              </span>
            )}
          </span>
        </button>
      </nav>

      {/* Ranked Top Hit List with Confidence Scores */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col border-t border-slate-200 p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <Compass className="h-3 w-3 text-emerald-600" />
            {CATEGORY_HIT_TITLES[activeCategory]}
          </span>
          <span className="text-[10px] font-mono text-slate-400">Score %</span>
        </div>

        <div className="space-y-1">
          {sidebarItems.map((item, idx) => {
            const isCurrent =
              activeView === 'charts' &&
              selectedAsset.symbol === item.symbol &&
              selectedAsset.category === activeCategory;

            const scoreColorClass =
              item.score === null
                ? 'border-slate-200 bg-slate-100 text-slate-500'
                : item.score >= 70
                ? item.direction === 'SHORT'
                  ? 'border-rose-300 bg-rose-50 text-rose-800'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : item.score >= 40
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-100 text-slate-500';

            return (
              <button
                key={item.symbol}
                type="button"
                title={
                  item.score !== null
                    ? `${item.displaySymbol} — ${item.tradeAction} (${item.score}% • ${item.wallLabel})`
                    : `${item.displaySymbol} — Scoring MTF polarity...`
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
                  {item.direction === 'LONG' && (
                    <span className="rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-800">
                      L
                    </span>
                  )}
                  {item.direction === 'SHORT' && (
                    <span className="rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-800">
                      S
                    </span>
                  )}
                  <span className="truncate">{item.displaySymbol}</span>
                </span>

                {item.score !== null ? (
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] font-bold shrink-0',
                      scoreColorClass
                    )}
                  >
                    {item.score}%
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

      {/* Proprietary ATS Polarity Reference Legend */}
      <div className="hidden lg:block border-t border-slate-200 p-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-[11px]">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
            <span>ATS Matrix Legend</span>
          </div>
          <div className="space-y-1 text-slate-600 leading-relaxed">
            <p>
              <strong className="text-slate-900 font-mono">Jack:</strong> Closes
              at <span className="font-mono">t-21, t-20, t-19</span> (M20)
            </p>
            <p>
              <strong className="text-slate-900 font-mono">Oggy:</strong> Closes
              at <span className="font-mono">t-8, t-7, t-6</span> (M7)
            </p>
            <p>
              <strong className="text-slate-900 font-mono">Didi:</strong>{' '}
              Nearest HTF opposing polarity target (TP1)
            </p>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-200 font-mono text-[10px] font-semibold">
            <span className="text-emerald-700 flex items-center gap-1">
              <Layers className="h-3 w-3" /> GREEN = Support
            </span>
            <span className="text-rose-700">RED = Resist</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
