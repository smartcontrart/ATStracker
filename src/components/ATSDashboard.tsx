'use client';

import React, { useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChartsView } from '@/components/charts/ChartsView';
import { Sidebar } from '@/components/layout/Sidebar';
import { ScreenerView } from '@/components/screener/ScreenerView';
import { type ActiveDashboardView, useATSStore } from '@/store/useATSStore';
import type { AssetCategory, ScreenerResult } from '@/types/ats';

const VALID_CATEGORIES = new Set<AssetCategory>(['stocks', 'crypto', 'forex']);

export const ATSDashboard: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    activeView,
    activeCategory,
    setActiveView,
    setActiveCategory,
    selectAssetAndNavigate,
    selectedAsset,
    watchlists,
    screenerResults,
    screenerLoading,
    getActiveSymbolsForCategory,
    startCategoryScan,
    appendScreenerBatch,
    finishCategoryScan,
  } = useATSStore();

  // Synchronize deep-link URL query parameters (?view=charts&symbol=AAPL&category=stocks) into Zustand
  useEffect(() => {
    const viewParam = searchParams.get('view');
    const symbolParam = searchParams.get('symbol');
    const categoryParam = searchParams.get('category') as AssetCategory | null;

    const validCategory: AssetCategory =
      categoryParam && VALID_CATEGORIES.has(categoryParam)
        ? categoryParam
        : selectedAsset.category;

    if (symbolParam) {
      selectAssetAndNavigate(symbolParam.toUpperCase(), validCategory);
    } else if (viewParam === 'charts' || viewParam === 'screener') {
      setActiveView(viewParam);
      if (categoryParam && VALID_CATEGORIES.has(categoryParam)) {
        setActiveCategory(categoryParam);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Background warmup when starting directly on the 6-Chart Page so Sidebar Top Hit List
  // and Quick Switch tickers always display live Confidence Scores
  useEffect(() => {
    if (activeView !== 'charts') return;
    if (
      screenerResults[activeCategory].length > 0 ||
      screenerLoading[activeCategory]
    ) {
      return;
    }

    let cancelled = false;
    const warmupSymbols = getActiveSymbolsForCategory(activeCategory).slice(
      0,
      25
    );
    if (warmupSymbols.length === 0) return;

    startCategoryScan(activeCategory, warmupSymbols.length, false);
    const qs = new URLSearchParams({
      category: activeCategory,
      symbols: warmupSymbols.join(','),
    });

    fetch(`/api/screener?${qs.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        appendScreenerBatch(
          activeCategory,
          (json.results || []) as ScreenerResult[],
          warmupSymbols.length,
          warmupSymbols.length
        );
        finishCategoryScan(activeCategory, null);
      })
      .catch(() => {
        if (!cancelled) finishCategoryScan(activeCategory, null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeCategory,
    activeView,
    appendScreenerBatch,
    finishCategoryScan,
    getActiveSymbolsForCategory,
    screenerLoading,
    screenerResults,
    startCategoryScan,
  ]);

  const handleNavigateView = useCallback(
    (view: ActiveDashboardView) => {
      setActiveView(view);
      if (view === 'screener') {
        router.push('/?view=screener', { scroll: false });
      } else {
        const qs = new URLSearchParams({
          view: 'charts',
          symbol: selectedAsset.symbol,
          category: selectedAsset.category,
        });
        router.push(`/?${qs.toString()}`, { scroll: false });
      }
    },
    [router, selectedAsset.category, selectedAsset.symbol, setActiveView]
  );

  const handleSelectCandidate = useCallback(
    (symbol: string, category: AssetCategory) => {
      selectAssetAndNavigate(symbol, category);
      const qs = new URLSearchParams({
        view: 'charts',
        symbol,
        category,
      });
      router.push(`/?${qs.toString()}`, { scroll: false });
    },
    [router, selectAssetAndNavigate]
  );

  const handleSwitchCategory = useCallback(
    (nextCategory: AssetCategory) => {
      setActiveCategory(nextCategory);

      if (activeView === 'charts') {
        const topScanned = [...screenerResults[nextCategory]].sort(
          (a, b) => b.confidenceScore - a.confidenceScore
        )[0];
        const fallbackSymbol =
          topScanned?.symbol ||
          watchlists[nextCategory][0] ||
          (nextCategory === 'crypto'
            ? 'BTCUSDT'
            : nextCategory === 'forex'
            ? 'EURUSD=X'
            : 'AAPL');

        selectAssetAndNavigate(fallbackSymbol, nextCategory);
        const qs = new URLSearchParams({
          view: 'charts',
          symbol: fallbackSymbol,
          category: nextCategory,
        });
        router.push(`/?${qs.toString()}`, { scroll: false });
      } else {
        const qs = new URLSearchParams({
          view: 'screener',
          category: nextCategory,
        });
        router.push(`/?${qs.toString()}`, { scroll: false });
      }
    },
    [
      activeView,
      router,
      screenerResults,
      selectAssetAndNavigate,
      setActiveCategory,
      watchlists,
    ]
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#050810] text-slate-100 lg:flex-row">
      <Sidebar
        onNavigateView={handleNavigateView}
        onSelectAsset={handleSelectCandidate}
        onSwitchCategory={handleSwitchCategory}
      />

      <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-y-auto">
        {activeView === 'screener' ? (
          <ScreenerView
            onSelectCandidate={handleSelectCandidate}
            onSwitchCategory={handleSwitchCategory}
          />
        ) : (
          <ChartsView
            onBackToScreener={() => handleNavigateView('screener')}
            onChangeTicker={handleSelectCandidate}
            onSwitchCategory={handleSwitchCategory}
          />
        )}
      </main>
    </div>
  );
};
