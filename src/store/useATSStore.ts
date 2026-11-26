'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { UNIVERSE_PRESETS } from '@/lib/assetUniverses';
import { compareScreenerResults, type ScreenerSortKey } from '@/lib/atsScreener';
import type { AssetCategory, ScreenerResult } from '@/types/ats';

export type ActiveDashboardView = 'screener' | 'charts';
export type DirectionFilter = 'ALL' | 'LONG' | 'SHORT';
export type StockIndexFilter = 'sp500' | 'stoxx600' | 'russell2000';
export type AtsStateFilter =
  | 'ALL'
  | 'ACTIVE'
  | 'STEP2'
  | 'STEP1'
  | 'INVALIDATED';

export interface ATSUIPreferences {
  showJack: boolean;
  showOggy: boolean;
  showBollinger: boolean;
  showSAR: boolean;
  showDidi: boolean;
  syncCrosshair: boolean;
  onlyWallCandidates: boolean;
  directionFilter: DirectionFilter;
  stateFilter: AtsStateFilter;
  sortBy: ScreenerSortKey;
  indexFilters: StockIndexFilter[];
}

export interface ScanProgressState {
  completed: number;
  total: number;
}

export interface SnapshotCacheEntry {
  scannedAt: string;
  universes: Record<string, string[]>;
  results: ScreenerResult[];
}

function filterSnapshotForPreset(
  snapshot: SnapshotCacheEntry,
  category: AssetCategory,
  presetId: string,
  watchlist: string[]
): ScreenerResult[] {
  if (
    presetId === 'all_combined' ||
    presetId === 'top100' ||
    presetId === 'top50'
  ) {
    return sortScreenerRows(snapshot.results);
  }

  let allowed: Set<string> | null = null;
  if (presetId === 'custom') {
    allowed = new Set(watchlist);
  } else if (
    snapshot.universes &&
    Array.isArray(snapshot.universes[presetId]) &&
    snapshot.universes[presetId].length > 0
  ) {
    allowed = new Set(snapshot.universes[presetId]);
  } else {
    const presetObj = UNIVERSE_PRESETS[category].find((p) => p.id === presetId);
    if (presetObj?.tickers) {
      allowed = new Set(presetObj.tickers);
    }
  }

  if (!allowed) return sortScreenerRows(snapshot.results);
  return sortScreenerRows(
    snapshot.results.filter(
      (r) => allowed!.has(r.symbol) || allowed!.has(r.displaySymbol)
    )
  );
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
    'DX-Y.NYB', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X',
    'USDCAD=X', 'USDCHF=X', 'NZDUSD=X', 'USDMXN=X', 'EURJPY=X',
  ],
};

function formatWatchlistTicker(raw: string, category: AssetCategory): string {
  const clean = raw.trim().toUpperCase();
  if (!clean) return '';

  if (clean === 'DXY' || clean === 'DX-Y.NYB') return 'DX-Y.NYB';
  if (clean === 'DJI' || clean === '^DJI') return '^DJI';

  if (category === 'forex') {
    const alpha = clean.replace(/=X$/i, '').replace(/[^A-Z]/g, '');
    if (alpha.length === 6) return `${alpha}=X`;
    return clean.endsWith('=X') ? clean : `${clean}=X`;
  }

  if (category === 'crypto') {
    const stripped = clean.replace(/[-/]/g, '').replace(/USD$/, 'USDT');
    return stripped.endsWith('USDT') ? stripped : `${stripped}USDT`;
  }

  return clean.replace(/^([A-Z0-9]+)\.([AB])$/, '$1-$2');
}

function sortScreenerRows(rows: ScreenerResult[]): ScreenerResult[] {
  return [...rows].sort((a, b) => compareScreenerResults(a, b, 'STATE'));
}

type BooleanPreferenceKey = Exclude<
  keyof ATSUIPreferences,
  'directionFilter' | 'stateFilter' | 'sortBy' | 'indexFilters'
>;

interface ATSStoreState {
  watchlists: Record<AssetCategory, string[]>;
  universePreset: Record<AssetCategory, string>;
  activeView: ActiveDashboardView;
  activeCategory: AssetCategory;
  selectedAsset: {
    symbol: string;
    category: AssetCategory;
  };
  uiPreferences: ATSUIPreferences;

  screenerResults: Record<AssetCategory, ScreenerResult[]>;
  screenerLoading: Record<AssetCategory, boolean>;
  scanProgress: Record<AssetCategory, ScanProgressState>;
  screenerErrors: Record<AssetCategory, string | null>;
  lastScannedAt: Record<AssetCategory, string | null>;
  snapshotCache: Record<AssetCategory, SnapshotCacheEntry | null>;
  dataSource: Record<AssetCategory, 'snapshot' | 'live' | null>;
  snapshotChecked: Record<AssetCategory, boolean>;

  getActiveSymbolsForCategory: (category: AssetCategory) => string[];
  getPresetCount: (category: AssetCategory, presetId: string) => number | null;

  setActiveView: (view: ActiveDashboardView) => void;
  setActiveCategory: (category: AssetCategory) => void;
  setUniversePreset: (category: AssetCategory, presetId: string) => void;
  loadSnapshot: (category: AssetCategory, entry: SnapshotCacheEntry) => void;
  markSnapshotChecked: (category: AssetCategory) => void;
  selectAssetAndNavigate: (symbol: string, category: AssetCategory) => void;
  setSelectedAsset: (symbol: string, category: AssetCategory) => void;
  addTicker: (rawTicker: string, category: AssetCategory) => string | null;
  removeTicker: (symbol: string, category: AssetCategory) => void;
  resetWatchlist: (category: AssetCategory) => void;
  toggleUIPreference: (key: BooleanPreferenceKey) => void;
  setDirectionFilter: (dir: DirectionFilter) => void;
  setStateFilter: (filter: AtsStateFilter) => void;
  setSortBy: (sortKey: ScreenerSortKey) => void;
  toggleIndexFilter: (index: StockIndexFilter) => void;
  clearIndexFilters: () => void;

  startCategoryScan: (
    category: AssetCategory,
    total: number,
    clearExisting?: boolean
  ) => void;
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
        stocks: 'all_combined',
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
        stateFilter: 'ALL',
        sortBy: 'STATE',
        indexFilters: [],
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
      snapshotCache: {
        stocks: null,
        crypto: null,
        forex: null,
      },
      dataSource: {
        stocks: null,
        crypto: null,
        forex: null,
      },
      snapshotChecked: {
        stocks: false,
        crypto: false,
        forex: false,
      },

      getActiveSymbolsForCategory: (category) => {
        const state = get();
        const presetId = state.universePreset[category];
        const snap = state.snapshotCache[category];
        if (snap && presetId !== 'custom') {
          if (
            presetId === 'all_combined' ||
            presetId === 'top100' ||
            presetId === 'top50'
          ) {
            return snap.results.map((r) => r.symbol);
          }
          if (
            snap.universes[presetId] &&
            snap.universes[presetId].length > 0
          ) {
            return snap.universes[presetId];
          }
        }
        const presetObj = UNIVERSE_PRESETS[category].find(
          (p) => p.id === presetId
        );
        if (!presetObj || presetObj.tickers === null) {
          return state.watchlists[category];
        }
        return Array.from(
          new Set([...state.watchlists[category], ...presetObj.tickers])
        );
      },

      getPresetCount: (category, presetId) => {
        const state = get();
        const snap = state.snapshotCache[category];
        if (snap) {
          if (
            presetId === 'all_combined' ||
            presetId === 'top100' ||
            presetId === 'top50'
          ) {
            return snap.results.length;
          }
          if (snap.universes[presetId]) {
            return snap.universes[presetId].length;
          }
        }
        if (presetId === 'custom') return state.watchlists[category].length;
        const presetObj = UNIVERSE_PRESETS[category].find(
          (p) => p.id === presetId
        );
        return presetObj?.tickers ? presetObj.tickers.length : null;
      },

      setActiveView: (view) => set({ activeView: view }),

      setActiveCategory: (category) => set({ activeCategory: category }),

      setUniversePreset: (category, presetId) =>
        set((state) => {
          const snap = state.snapshotCache[category];
          if (snap && presetId !== 'custom') {
            const filtered = filterSnapshotForPreset(
              snap,
              category,
              presetId,
              state.watchlists[category]
            );
            return {
              universePreset: {
                ...state.universePreset,
                [category]: presetId,
              },
              screenerResults: {
                ...state.screenerResults,
                [category]: filtered,
              },
              dataSource: {
                ...state.dataSource,
                [category]: 'snapshot',
              },
              screenerErrors: {
                ...state.screenerErrors,
                [category]: null,
              },
            };
          }
          return {
            universePreset: {
              ...state.universePreset,
              [category]: presetId,
            },
            screenerResults: {
              ...state.screenerResults,
              [category]: [],
            },
          };
        }),

      loadSnapshot: (category, entry) =>
        set((state) => {
          const presetId = state.universePreset[category];
          const filtered = filterSnapshotForPreset(
            entry,
            category,
            presetId,
            state.watchlists[category]
          );
          return {
            snapshotCache: {
              ...state.snapshotCache,
              [category]: entry,
            },
            snapshotChecked: {
              ...state.snapshotChecked,
              [category]: true,
            },
            dataSource: {
              ...state.dataSource,
              [category]: 'snapshot',
            },
            screenerResults: {
              ...state.screenerResults,
              [category]: filtered,
            },
            screenerLoading: {
              ...state.screenerLoading,
              [category]: false,
            },
            screenerErrors: {
              ...state.screenerErrors,
              [category]: null,
            },
            lastScannedAt: {
              ...state.lastScannedAt,
              [category]: entry.scannedAt,
            },
          };
        }),

      markSnapshotChecked: (category) =>
        set((state) => ({
          snapshotChecked: {
            ...state.snapshotChecked,
            [category]: true,
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

      setStateFilter: (stateFilter) =>
        set((state) => ({
          uiPreferences: {
            ...state.uiPreferences,
            stateFilter,
          },
        })),

      setSortBy: (sortBy) =>
        set((state) => ({
          uiPreferences: {
            ...state.uiPreferences,
            sortBy,
          },
        })),

      toggleIndexFilter: (index) =>
        set((state) => {
          const current = state.uiPreferences.indexFilters ?? [];
          const exists = current.includes(index);
          const next = exists
            ? current.filter((i) => i !== index)
            : [...current, index];
          return {
            uiPreferences: {
              ...state.uiPreferences,
              indexFilters: next,
            },
          };
        }),

      clearIndexFilters: () =>
        set((state) => ({
          uiPreferences: {
            ...state.uiPreferences,
            indexFilters: [],
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

          // Also keep snapshotCache warm with any fresh live intraday updates
          const existingSnap = state.snapshotCache[category];
          let nextSnap = existingSnap;
          if (existingSnap && batchResults.length > 0) {
            const snapMap = new Map<string, ScreenerResult>();
            for (const s of existingSnap.results) snapMap.set(s.symbol, s);
            for (const inc of batchResults) snapMap.set(inc.symbol, inc);
            nextSnap = {
              ...existingSnap,
              results: sortScreenerRows(Array.from(snapMap.values())),
            };
          }

          return {
            screenerResults: {
              ...state.screenerResults,
              [category]: merged,
            },
            snapshotCache: {
              ...state.snapshotCache,
              [category]: nextSnap,
            },
            dataSource: {
              ...state.dataSource,
              [category]: existingSnap ? 'snapshot' : 'live',
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

          const existingSnap = state.snapshotCache[cat];
          let nextSnap = existingSnap;
          if (existingSnap) {
            const snapMap = new Map<string, ScreenerResult>();
            for (const s of existingSnap.results) snapMap.set(s.symbol, s);
            snapMap.set(result.symbol, result);
            nextSnap = {
              ...existingSnap,
              results: sortScreenerRows(Array.from(snapMap.values())),
            };
          }

          return {
            screenerResults: {
              ...state.screenerResults,
              [cat]: sortScreenerRows(Array.from(map.values())),
            },
            snapshotCache: {
              ...state.snapshotCache,
              [cat]: nextSnap,
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
      name: 'ats-mtf-screener-storage-v4',
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
