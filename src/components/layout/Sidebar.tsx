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
import { cn } from '@/lib/utils';
import { type ActiveDashboardView, useATSStore } from '@/store/useATSStore';
import type { AssetCategory } from '@/types/ats';

interface SidebarProps {
  onNavigateView: (view: ActiveDashboardView) => void;
  onSelectAsset: (symbol: string, category: AssetCategory) => void;
}

const CATEGORY_HIT_TITLES: Record<AssetCategory, string> = {
  stocks: 'Top Stock Hit List',
  crypto: 'Top Crypto Hit List',
  forex: 'Top Forex Hit List',
};

export const Sidebar: React.FC<SidebarProps> = ({
  onNavigateView,
  onSelectAsset,
}) => {
  const {
    activeView,
    activeCategory,
    selectedAsset,
    watchlists,
    screenerResults,
    screenerLoading,
  } = useATSStore();

  const totalWallHits =
    screenerResults.stocks.filter((r) => r.isAtWall).length +
    screenerResults.crypto.filter((r) => r.isAtWall).length +
    screenerResults.forex.filter((r) => r.isAtWall).length;

  const selectedAssetScore = useMemo(() => {
    const found = screenerResults[selectedAsset.category].find(
      (r) => r.symbol === selectedAsset.symbol
    );
    return found ? found.confidenceScore : null;
  }, [screenerResults, selectedAsset.category, selectedAsset.symbol]);

  // Ranked Top Hit List sorted strictly by Confidence Score descending
  const sidebarItems = useMemo(() => {
    const scanned = [...screenerResults[activeCategory]].sort(
      (a, b) => b.confidenceScore - a.confidenceScore
    );
    if (scanned.length > 0) {
      return scanned.slice(0, 25).map((r) => ({
        symbol: r.symbol,
        displaySymbol: r.displaySymbol,
        score: r.confidenceScore,
        isAtWall: r.isAtWall,
        direction: r.direction,
        wallLabel: r.activeWallLabel,
      }));
    }
    return watchlists[activeCategory].slice(0, 20).map((sym) => ({
      symbol: sym,
      displaySymbol: sym.replace(/=X$/, ''),
      score: null as number | null,
      isAtWall: false,
      direction: 'NEUTRAL' as const,
      wallLabel: '',
    }));
  }, [activeCategory, screenerResults, watchlists]);

  return (
    <aside className="flex w-full flex-col border-b border-slate-800/90 bg-slate-950/95 lg:w-68 lg:shrink-0 lg:border-b-0 lg:border-r lg:min-h-screen">
      {/* Brand Header */}
      <div className="flex items-center justify-between border-b border-slate-800/90 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold tracking-wider text-white">
                ATS ENGINE
              </span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                MTF
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Action Trading System</p>
          </div>
        </div>
      </div>

      {/* Universal Stock / Crypto / FX Lookup Spotlight */}
      <div className="border-b border-slate-800/80 px-3 py-2.5">
        <GlobalAssetLookup onSelectForCharts={onSelectAsset} />
      </div>

      {/* Primary View Navigation */}
      <nav className="p-3 space-y-1.5">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Workspace Views
        </p>

        <button
          type="button"
          onClick={() => onNavigateView('screener')}
          className={cn(
            'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
            activeView === 'screener'
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shadow-sm'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
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
            'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
            activeView === 'charts'
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shadow-sm'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
          )}
        >
          <span className="flex items-center gap-2.5">
            <BarChart3 className="h-4 w-4" />
            <span>6-Pane ATS Charts</span>
          </span>
          <span className="flex items-center gap-1 font-mono text-[11px] text-slate-300">
            <span>{selectedAsset.symbol.replace(/=X$/, '')}</span>
            {selectedAssetScore !== null && (
              <span className="rounded bg-slate-800 px-1 py-0.2 text-[10px] text-emerald-400 font-bold">
                {selectedAssetScore}%
              </span>
            )}
          </span>
        </button>
      </nav>

      {/* Ranked Top Hit List with Confidence Scores */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col border-t border-slate-800/80 p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            <Compass className="h-3 w-3 text-emerald-400" />
            {CATEGORY_HIT_TITLES[activeCategory]}
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            Score %
          </span>
        </div>

        <div className="space-y-1">
          {sidebarItems.map((item, idx) => {
            const isCurrent =
              activeView === 'charts' &&
              selectedAsset.symbol === item.symbol &&
              selectedAsset.category === activeCategory;

            const scoreColorClass =
              item.score === null
                ? 'border-slate-800 bg-slate-900 text-slate-500'
                : item.score >= 70
                ? item.direction === 'SHORT'
                  ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                  : 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                : item.score >= 45
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-slate-700 bg-slate-900 text-slate-300';

            return (
              <button
                key={item.symbol}
                type="button"
                title={
                  item.score !== null
                    ? `${item.displaySymbol} — Confidence: ${item.score}% (${item.direction} • ${item.wallLabel})`
                    : `${item.displaySymbol} — Scoring MTF polarity...`
                }
                onClick={() => onSelectAsset(item.symbol, activeCategory)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-mono transition-colors border',
                  isCurrent
                    ? 'border-emerald-500/50 bg-slate-800/90 text-white font-semibold'
                    : 'border-transparent text-slate-300 hover:bg-slate-900 hover:text-white'
                )}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className="w-4 text-[10px] text-slate-500 text-right">
                    {idx + 1}.
                  </span>
                  {item.direction === 'LONG' && (
                    <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-400">
                      L
                    </span>
                  )}
                  {item.direction === 'SHORT' && (
                    <span className="rounded bg-rose-500/20 px-1 text-[9px] font-bold text-rose-400">
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
                  <Loader2 className="h-3 w-3 animate-spin text-slate-500 shrink-0" />
                ) : (
                  <span className="text-[10px] text-slate-600">—</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Proprietary ATS Polarity Reference Legend */}
      <div className="hidden lg:block border-t border-slate-800/80 p-3">
        <div className="rounded-lg border border-slate-800/90 bg-slate-900/60 p-3 space-y-2 text-[11px]">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
            <span>ATS Matrix Legend</span>
          </div>
          <div className="space-y-1 text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-200 font-mono">Jack:</strong> Closes
              at <span className="font-mono">t-21, t-20, t-19</span> (M20)
            </p>
            <p>
              <strong className="text-slate-200 font-mono">Oggy:</strong> Closes
              at <span className="font-mono">t-8, t-7, t-6</span> (M7)
            </p>
            <p>
              <strong className="text-slate-200 font-mono">Didi:</strong>{' '}
              Nearest HTF opposing polarity target (TP1)
            </p>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-800 font-mono text-[10px]">
            <span className="text-emerald-400 flex items-center gap-1">
              <Layers className="h-3 w-3" /> GREEN = Support
            </span>
            <span className="text-rose-400">RED = Resist</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
