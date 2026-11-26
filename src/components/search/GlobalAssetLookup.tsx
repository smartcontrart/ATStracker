'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Loader2,
  Radar,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { AssetSearchItem } from '@/app/api/search/route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatPrice } from '@/lib/utils';
import { useATSStore } from '@/store/useATSStore';
import {
  ALL_TIMEFRAMES,
  type AssetCategory,
  type MTFAssetPayload,
} from '@/types/ats';

interface GlobalAssetLookupProps {
  onSelectForCharts: (symbol: string, category: AssetCategory) => void;
  compact?: boolean;
}

type CategoryTab = 'all' | AssetCategory;

const QUICK_SUGGESTIONS: AssetSearchItem[] = [
  {
    symbol: 'NVDA',
    displaySymbol: 'NVDA',
    name: 'NVIDIA Corporation',
    category: 'stocks',
    exchange: 'NASDAQ',
    typeLabel: 'Stock',
  },
  {
    symbol: 'TSM',
    displaySymbol: 'TSM',
    name: 'Taiwan Semiconductor Manufacturing',
    category: 'stocks',
    exchange: 'NYSE',
    typeLabel: 'Stock',
  },
  {
    symbol: 'BTCUSDT',
    displaySymbol: 'BTC/USDT',
    name: 'Bitcoin (BTC)',
    category: 'crypto',
    exchange: 'Binance / Spot',
    typeLabel: 'Crypto',
  },
  {
    symbol: 'SOLUSDT',
    displaySymbol: 'SOL/USDT',
    name: 'Solana (SOL)',
    category: 'crypto',
    exchange: 'Binance / Spot',
    typeLabel: 'Crypto',
  },
  {
    symbol: 'EURUSD=X',
    displaySymbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'forex',
    exchange: 'FX Spot',
    typeLabel: 'Forex Pair',
  },
  {
    symbol: 'USDJPY=X',
    displaySymbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'forex',
    exchange: 'FX Spot',
    typeLabel: 'Forex Pair',
  },
];

export const GlobalAssetLookup: React.FC<GlobalAssetLookupProps> = ({
  onSelectForCharts,
  compact = false,
}) => {
  const { addTicker, appendScreenerBatch, scanProgress, watchlists } =
    useATSStore();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all');
  const [results, setResults] = useState<AssetSearchItem[]>(QUICK_SUGGESTIONS);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const [inspectingKey, setInspectingKey] = useState<string | null>(null);
  const [inspectedPayload, setInspectedPayload] =
    useState<MTFAssetPayload | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [savedToastSymbol, setSavedToastSymbol] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleCustomOpen = () => setIsOpen(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('ats:open-lookup', handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('ats:open-lookup', handleCustomOpen);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setInspectedPayload(null);
      setInspectError(null);
      setInspectingKey(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(QUICK_SUGGESTIONS);
      setSearching(false);
      setActiveIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (res.ok) {
          const json = await res.json();
          setResults((json.results || []) as AssetSearchItem[]);
          setActiveIndex(0);
        }
      } catch {
        // Keep current results
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  const filteredResults = results.filter((item) =>
    categoryTab === 'all' ? true : item.category === categoryTab
  );

  const handleOpenInCharts = useCallback(
    (symbol: string, category: AssetCategory) => {
      setIsOpen(false);
      onSelectForCharts(symbol, category);
    },
    [onSelectForCharts]
  );

  const handleQuickInspect = useCallback(
    async (symbol: string, category: AssetCategory) => {
      const key = `${category}:${symbol}`;
      setInspectingKey(key);
      setInspectError(null);
      setInspectedPayload(null);

      try {
        const qs = new URLSearchParams({ symbol, category });
        const res = await fetch(`/api/market?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json?.error || `Could not analyze ${symbol} (${res.status})`
          );
        }
        setInspectedPayload(json as MTFAssetPayload);
      } catch (err) {
        setInspectError(
          err instanceof Error ? err.message : 'ATS quick lookup failed'
        );
      } finally {
        setInspectingKey(null);
      }
    },
    []
  );

  const handleSaveToWatchlist = useCallback(
    async (
      symbol: string,
      category: AssetCategory,
      existingPayload?: MTFAssetPayload | null
    ) => {
      const formatted = addTicker(symbol, category);
      if (!formatted) return;

      setSavedToastSymbol(formatted);
      setTimeout(() => setSavedToastSymbol(null), 2200);

      if (existingPayload && existingPayload.symbol === formatted) {
        const cur = scanProgress[category];
        appendScreenerBatch(
          category,
          [existingPayload.screener],
          cur.completed + 1,
          cur.total + 1
        );
        return;
      }

      try {
        const qs = new URLSearchParams({ category, symbols: formatted });
        const res = await fetch(`/api/screener?${qs.toString()}`);
        if (res.ok) {
          const json = await res.json();
          const cur = useATSStore.getState().scanProgress[category];
          appendScreenerBatch(
            category,
            json.results || [],
            cur.completed + 1,
            cur.total + 1
          );
        }
      } catch {
        // Non-fatal
      }
    },
    [addTicker, appendScreenerBatch, scanProgress]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredResults.length > 0 ? (prev + 1) % filteredResults.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredResults.length > 0
          ? (prev - 1 + filteredResults.length) % filteredResults.length
          : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredResults[activeIndex]) {
        const picked = filteredResults[activeIndex];
        handleOpenInCharts(picked.symbol, picked.category);
      } else if (query.trim()) {
        const fallbackCategory: AssetCategory =
          categoryTab === 'all' ? 'stocks' : categoryTab;
        handleOpenInCharts(query.trim().toUpperCase(), fallbackCategory);
      }
    }
  };

  const categoryBadgeVariant = (cat: AssetCategory) => {
    if (cat === 'stocks') return 'sky' as const;
    if (cat === 'crypto') return 'amber' as const;
    return 'support' as const;
  };

  return (
    <>
      {/* Trigger Bar */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white text-left text-xs text-slate-500 shadow-sm transition-all hover:border-emerald-500 hover:text-slate-800',
          compact ? 'h-8 px-3' : 'w-full px-3 py-2'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Search className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span className="truncate">
            {compact ? 'Lookup Asset...' : 'Lookup Stock, Crypto, FX...'}
          </span>
        </span>
        <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Spotlight Modal Overlay — Portaled to document.body */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{ zIndex: 9999 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-12 sm:pt-20 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          >
            <div
              className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Search Input Bar */}
              <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600 shrink-0" />
                ) : (
                  <Search className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search any Stock (AAPL, TSM, RKLB), Crypto (BTC, SOL, HYPE), or Currency Pair (EUR/USD, USDZAR)..."
                  className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  ESC
                </button>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'All Assets' },
                      { id: 'stocks', label: 'Stocks & ETFs' },
                      { id: 'crypto', label: 'Crypto' },
                      { id: 'forex', label: 'Currency Pairs' },
                    ] as Array<{ id: CategoryTab; label: string }>
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCategoryTab(tab.id)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors border',
                        categoryTab === tab.id
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500 hidden sm:inline">
                  Click &ldquo;Quick Check&rdquo; for instant ATS score or row for 6-Pane Charts
                </span>
              </div>

              {/* Live Inline Quick ATS Inspection Card */}
              {(inspectingKey || inspectedPayload || inspectError) && (
                <div className="border-b border-slate-200 bg-amber-50/40 p-4">
                  {inspectingKey && (
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-700 font-medium">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Computing 6-Timeframe ATS Polarity Matrix (D, W, M, 3M, 6M, 12M)...
                    </div>
                  )}

                  {inspectError && (
                    <div className="text-xs text-rose-600 font-medium">
                      Could not analyze ticker: {inspectError}
                    </div>
                  )}

                  {inspectedPayload && (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-base font-bold text-slate-900">
                              {inspectedPayload.displaySymbol}
                            </span>
                            <span className="text-xs text-slate-500">
                              {inspectedPayload.name}
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {formatPrice(
                                inspectedPayload.livePrice,
                                inspectedPayload.category
                              )}
                            </span>
                            <Badge
                              variant={
                                inspectedPayload.screener.atsState ===
                                'STEP 2: REVERSAL CONFIRMED'
                                  ? inspectedPayload.screener.setupSide ===
                                    'SELL'
                                    ? 'resistance'
                                    : 'support'
                                  : inspectedPayload.screener.atsState ===
                                    'STEP 1: THE WALL'
                                  ? 'amber'
                                  : inspectedPayload.screener.atsState ===
                                    'INVALIDATED'
                                  ? 'resistance'
                                  : 'outline'
                              }
                              className="font-mono text-[10px]"
                            >
                              {inspectedPayload.screener.atsState} •{' '}
                              {inspectedPayload.screener.ClusterDensityCount}L •
                              Didi{' '}
                              {inspectedPayload.screener.RiskToDidi.toFixed(2)}%
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-700">
                            {inspectedPayload.screener.thesisHeadline}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleSaveToWatchlist(
                                inspectedPayload.symbol,
                                inspectedPayload.category,
                                inspectedPayload
                              )
                            }
                          >
                            {savedToastSymbol === inspectedPayload.symbol ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                Saved
                              </>
                            ) : (
                              <>
                                <BookmarkPlus className="h-3.5 w-3.5" />
                                + Watchlist
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              handleOpenInCharts(
                                inspectedPayload.symbol,
                                inspectedPayload.category
                              )
                            }
                          >
                            6-Pane Charts
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* 6-Timeframe Polarity Strip */}
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                        {ALL_TIMEFRAMES.map((tf) => {
                          const h = inspectedPayload.screener.horizonMatrix[tf];
                          const hasTouch = h.wallTouches.length > 0;
                          return (
                            <div
                              key={tf}
                              className={cn(
                                'rounded border px-2 py-1 text-center font-mono text-[10px]',
                                hasTouch
                                  ? 'border-emerald-400 bg-emerald-50 text-slate-900'
                                  : 'border-slate-200 bg-white text-slate-700'
                              )}
                            >
                              <div className="font-bold">
                                {tf} {hasTouch ? '★' : ''}
                              </div>
                              <div>
                                <span className="text-emerald-700 font-semibold">
                                  {h.greenCount}G
                                </span>{' '}
                                /{' '}
                                <span className="text-rose-700 font-semibold">
                                  {h.redCount}R
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs font-mono border-t border-slate-200 pt-2 text-slate-700">
                        <span>
                          Wall:{' '}
                          <strong className="text-slate-900">
                            {inspectedPayload.screener.activeWallLabel}
                          </strong>
                        </span>
                        <span>
                          SL:{' '}
                          <strong className="text-rose-700">
                            {formatPrice(
                              inspectedPayload.screener.stopLoss,
                              inspectedPayload.category
                            )}
                          </strong>
                        </span>
                        {inspectedPayload.screener.effectiveTargetTP1 && (
                          <span>
                            TP1 (Didi):{' '}
                            <strong className="text-emerald-700">
                              {formatPrice(
                                inspectedPayload.screener.effectiveTargetTP1.price,
                                inspectedPayload.category
                              )}{' '}
                              ({inspectedPayload.screener.effectiveTargetTP1.label})
                            </strong>
                          </span>
                        )}
                        {inspectedPayload.screener.riskRewardRatio !== null && (
                          <span className="text-amber-700 font-bold">
                            R:R {inspectedPayload.screener.riskRewardRatio.toFixed(2)}x
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Results List */}
              <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
                {!query.trim() && (
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50">
                    Popular Multi-Asset Lookups
                  </div>
                )}

                {filteredResults.map((item, idx) => {
                  const isSelected = idx === activeIndex;
                  const itemKey = `${item.category}:${item.symbol}`;
                  const inWatchlist = watchlists[item.category].includes(
                    item.symbol
                  );

                  return (
                    <div
                      key={itemKey}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() =>
                        handleOpenInCharts(item.symbol, item.category)
                      }
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 transition-colors',
                        isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge
                          variant={categoryBadgeVariant(item.category)}
                          className="font-mono text-[10px] w-20 justify-center shrink-0"
                        >
                          {item.typeLabel}
                        </Badge>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {item.displaySymbol}
                            </span>
                            {item.exchange && (
                              <span className="text-[10px] font-mono text-slate-500">
                                {item.exchange}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-slate-500">
                            {item.name}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleQuickInspect(item.symbol, item.category);
                          }}
                        >
                          <Radar className="h-3 w-3 text-emerald-600" />
                          Quick Check
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSaveToWatchlist(
                              item.symbol,
                              item.category
                            );
                          }}
                        >
                          {inWatchlist || savedToastSymbol === item.symbol ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              Saved
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="h-3 w-3" />
                              Save
                            </>
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-emerald-700 hover:text-emerald-800"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInCharts(item.symbol, item.category);
                          }}
                        >
                          Charts
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {query.trim().length > 0 && (
                  <div className="bg-slate-50 px-4 py-3">
                    <p className="mb-2 text-[11px] text-slate-600 flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-amber-600" />
                      Direct Lookup for{' '}
                      <strong className="font-mono text-slate-900">
                        {query.trim().toUpperCase()}
                      </strong>
                      :
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs font-mono"
                        onClick={() =>
                          void handleQuickInspect(
                            query.trim().toUpperCase(),
                            'stocks'
                          )
                        }
                      >
                        Quick Check as Stock/ETF
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs font-mono"
                        onClick={() =>
                          void handleQuickInspect(
                            query.trim().toUpperCase(),
                            'crypto'
                          )
                        }
                      >
                        Quick Check as Crypto
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs font-mono"
                        onClick={() =>
                          void handleQuickInspect(
                            query.trim().toUpperCase(),
                            'forex'
                          )
                        }
                      >
                        Quick Check as Forex Pair
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export function triggerGlobalAssetLookup(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ats:open-lookup'));
  }
}
