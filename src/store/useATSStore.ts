'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { UNIVERSE_PRESETS } from '@/lib/assetUniverses';
import type { AssetCategory, ScreenerResult } from '@/types/ats';

export type ActiveDashboardView = 'screener' | 'charts';
export type DirectionFilter = 'ALL' | 'LONG' | 'SHORT';

export interface ATSUIPreferences {
  showJack: boolean;
  showOggy: boolean;
  showBollinger: boolean;
  showSAR: boolean;
  showDidi: boolean;
  syncCrosshair: boolean;
  onlyWallCandidates: boolean;
  directionFilter: DirectionFilter;
}

export interface ScanProgressState {
  completed: number;
  total: number;
}

export const DEFAULT_WATCHLISTS: Record<AssetCategory, string[]> = {
  stocks: [
    'AAPL', 'NVDA', 'MSFT', 'TSLA', 'META', 'AMZN', 'GOOGL', 'AMD',
    'NFLX', 'PLTR', 'JPM', 'COIN', 'AVGO', 'SPY', 'QQQ',
  ],
  crypto: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
  ],
  forex: [
    'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X',
    'USDCHF=X', 'NZDUSD=X', 'USDMXN=X', 'USDSGD=X', 'EURJPY=X',
  ],
};

function formatWatchlistTicker(raw: string, category: AssetCategory): string {
  const clean = raw.trim().toUpperCase();
  if (!clean) return '';

  if (category === 'forex') {
    const alpha = clean.replace(/=X$/i, '').replace(/[^A-Z]/g, '');
    if (alpha.length === 6) return `${alpha}=X`;
    return clean.endsWith('=X') ? clean : `${clean}=X`;
  }

  if (category === 'crypto') {
    const stripped = clean.replace(/[-/]/g, '').replace(/USD$/, 'USDT');
    return stripped.endsWith('USDT') ? stripped : `${stripped}USDT`;
  }

  return clean.replace(/\./g, '-');
}

function sortScreenerRows(rows: ScreenerResult[]): ScreenerResult[] {
  return [...rows].sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    if (a.isAtWall !== b.isAtWall) return a.isAtWall ? -1 : 1;
    return b.setupStep - a.setupStep;
  });
}

interface ATSStoreState {
  // Persisted User State
  watchlists: Record<AssetCategory, string[]>;
  universePreset: Record<AssetCategory, string>;
  activeView: ActiveDashboardView;
  activeCategory: AssetCategory;
  selectedAsset: {
    symbol: string;
    category: AssetCategory;
  };
  uiPreferences: ATSUIPreferences;

  // Ephemeral Runtime Screener Cache
  screenerResults: Record<AssetCategory, ScreenerResult[]>;
  screenerLoading: Record<AssetCategory, boolean>;
  scanProgress: Record<AssetCategory, ScanProgressState>;
  screenerErrors: Record<AssetCategory, string | null>;
  lastScannedAt: Record<AssetCategory, string | null>;

  // Helpers
  getActiveSymbolsForCategory: (category: AssetCategory) => string[];

  // Actions
  setActiveView: (view: ActiveDashboardView) => void;
  setActiveCategory: (category: AssetCategory) => void;
  setUniversePreset: (category: AssetCategory, presetId: string) => void;
  selectAssetAndNavigate: (symbol: string, category: AssetCategory) => void;
  setSelectedAsset: (symbol: string, category: AssetCategory) => void;
  addTicker: (rawTicker: string, category: AssetCategory) => string | null;
  removeTicker: (symbol: string, category: AssetCategory) => void;
  resetWatchlist: (category: AssetCategory) => void;
  toggleUIPreference: (
    key: Exclude<keyof ATSUIPreferences, 'directionFilter'>
  ) => void;
  setDirectionFilter: (dir: DirectionFilter) => void;

  // Progressive batch screener setters
  startCategoryScan: (category: AssetCategory, total: number, clearExisting?: boolean) => void;
  appendScreenerBatch: (
    category: AssetCategory,
    batchResults: ScreenerResult[],
    completedCount: number,
    totalCount: number
  ) => void;
  upsertSingleScreenerResult: (result: ScreenerResult) => void;
  finishCategoryScan: (category: AssetCategory, error?: string | null) => void;
}

export const useATSStore = create<ATSStoreState>()(
  persist(
    (set, get) => ({
      watchlists: DEFAULT_WATCHLISTS,
      universePreset: {
        stocks: 'sp500',
        crypto: 'top100',
        forex: 'top50',
      },
      activeView: 'screener',
      activeCategory: 'stocks',
      selectedAsset: {
        symbol: 'AAPL',
        category: 'stocks',
      },
      uiPreferences: {
        showJack: true,
        showOggy: true,
        showBollinger: true,
        showSAR: true,
        showDidi: true,
        syncCrosshair: true,
        onlyWallCandidates: false,
        directionFilter: 'ALL',
      },

      screenerResults: {
        stocks: [],
        crypto: [],
        forex: [],
      },
      screenerLoading: {
        stocks: false,
        crypto: false,
        forex: false,
      },
      scanProgress: {
        stocks: { completed: 0, total: 0 },
        crypto: { completed: 0, total: 0 },
        forex: { completed: 0, total: 0 },
      },
      screenerErrors: {
        stocks: null,
        crypto: null,
        forex: null,
      },
      lastScannedAt: {
        stocks: null,
        crypto: null,
        forex: null,
      },

      getActiveSymbolsForCategory: (category) => {
        const state = get();
        const presetId = state.universePreset[category];
        const presetObj = UNIVERSE_PRESETS[category].find(
          (p) => p.id === presetId
        );
        if (!presetObj || presetObj.tickers === null) {
          return state.watchlists[category];
        }
        // Merge user's custom added tickers at the front so custom additions always appear even in S&P 500 / Top 100 mode!
        return Array.from(
          new Set([...state.watchlists[category], ...presetObj.tickers])
        );
      },

      setActiveView: (view) => set({ activeView: view }),

      setActiveCategory: (category) => set({ activeCategory: category }),

      setUniversePreset: (category, presetId) =>
        set((state) => ({
          universePreset: {
            ...state.universePreset,
            [category]: presetId,
          },
          screenerResults: {
            ...state.screenerResults,
            [category]: [],
          },
        })),

      selectAssetAndNavigate: (symbol, category) =>
        set({
          selectedAsset: { symbol, category },
          activeCategory: category,
          activeView: 'charts',
        }),

      setSelectedAsset: (symbol, category) =>
        set({
          selectedAsset: { symbol, category },
        }),

      addTicker: (rawTicker, category) => {
        const formatted = formatWatchlistTicker(rawTicker, category);
        if (!formatted) return null;

        const currentList = get().watchlists[category];
        if (!currentList.includes(formatted)) {
          set((state) => ({
            watchlists: {
              ...state.watchlists,
              [category]: [formatted, ...state.watchlists[category]],
            },
          }));
        }
        return formatted;
      },

      removeTicker: (symbol, category) =>
        set((state) => ({
          watchlists: {
            ...state.watchlists,
            [category]: state.watchlists[category].filter(
              (item) => item !== symbol
            ),
          },
          screenerResults: {
            ...state.screenerResults,
            [category]: state.screenerResults[category].filter(
              (r) => r.symbol !== symbol && r.displaySymbol !== symbol
            ),
          },
        })),

      resetWatchlist: (category) =>
        set((state) => ({
          watchlists: {
            ...state.watchlists,
            [category]: DEFAULT_WATCHLISTS[category],
          },
        })),

      toggleUIPreference: (key) =>
        set((state) => ({
          uiPreferences: {
            ...state.uiPreferences,
            [key]: !state.uiPreferences[key],
          },
        })),

      setDirectionFilter: (dir) =>
        set((state) => ({
          uiPreferences: {
            ...state.uiPreferences,
            directionFilter: dir,
          },
        })),

      startCategoryScan: (category, total, clearExisting = true) =>
        set((state) => ({
          screenerLoading: {
            ...state.screenerLoading,
            [category]: true,
          },
          scanProgress: {
            ...state.scanProgress,
            [category]: { completed: 0, total },
          },
          screenerErrors: {
            ...state.screenerErrors,
            [category]: null,
          },
          screenerResults: clearExisting
            ? { ...state.screenerResults, [category]: [] }
            : state.screenerResults,
        })),

      appendScreenerBatch: (
        category,
        batchResults,
        completedCount,
        totalCount
      ) =>
        set((state) => {
          const map = new Map<string, ScreenerResult>();
          for (const existing of state.screenerResults[category]) {
            map.set(existing.symbol, existing);
          }
          for (const incoming of batchResults) {
            map.set(incoming.symbol, incoming);
          }
          const merged = sortScreenerRows(Array.from(map.values()));

          return {
            screenerResults: {
              ...state.screenerResults,
              [category]: merged,
            },
            scanProgress: {
              ...state.scanProgress,
              [category]: { completed: completedCount, total: totalCount },
            },
            lastScannedAt: {
              ...state.lastScannedAt,
              [category]: new Date().toISOString(),
            },
          };
        }),

      upsertSingleScreenerResult: (result) =>
        set((state) => {
          const cat = result.category;
          const map = new Map<string, ScreenerResult>();
          for (const existing of state.screenerResults[cat]) {
            map.set(existing.symbol, existing);
          }
          map.set(result.symbol, result);
          return {
            screenerResults: {
              ...state.screenerResults,
              [cat]: sortScreenerRows(Array.from(map.values())),
            },
          };
        }),

      finishCategoryScan: (category, error = null) =>
        set((state) => ({
          screenerLoading: {
            ...state.screenerLoading,
            [category]: false,
          },
          screenerErrors: {
            ...state.screenerErrors,
            [category]: error,
          },
          lastScannedAt: {
            ...state.lastScannedAt,
            [category]: new Date().toISOString(),
          },
        })),
    }),
    {
      name: 'ats-mtf-screener-storage-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        watchlists: state.watchlists,
        universePreset: state.universePreset,
        activeView: state.activeView,
        activeCategory: state.activeCategory,
        selectedAsset: state.selectedAsset,
        uiPreferences: state.uiPreferences,
      }),
    }
  )
);
