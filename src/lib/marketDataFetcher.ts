import YahooFinance from 'yahoo-finance2';
import { computeAllTimeframesATS } from './atsIndicators.ts';
import { evaluateATSScreener } from './atsScreener.ts';
import { resampleAllTimeframes, sanitizeDailyBars } from './dataResampler.ts';
import { ALL_TIMEFRAMES } from '../types/ats.ts';
import type {
  AssetCategory,
  DailyOHLCV,
  MTFAssetPayload,
  Timeframe,
  TimeframeATSData,
} from '../types/ats.ts';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

interface RawMarketSeries {
  symbol: string;
  displaySymbol: string;
  name: string;
  currency: string;
  livePrice: number;
  change24hPct: number;
  source: string;
  dailyBars: DailyOHLCV[];
}

// Ephemeral per-isolate cache (60s TTL) to avoid duplicate upstream bursts; purely stateless
const ephemeralCache = new Map<
  string,
  { expiresAt: number; payload: MTFAssetPayload; isFullDepth: boolean }
>();
const CACHE_TTL_MS = 60_000;

export function normalizeTickerForCategory(
  rawTicker: string,
  category: AssetCategory
): {
  querySymbol: string;
  displaySymbol: string;
  baseCoin: string;
} {
  const cleaned = rawTicker.trim().toUpperCase();

  if (category === 'forex') {
    const lettersOnly = cleaned.replace(/=X$/i, '').replace(/[^A-Z]/g, '');
    if (lettersOnly.length === 6) {
      const base = lettersOnly.slice(0, 3);
      const quote = lettersOnly.slice(3, 6);
      return {
        querySymbol: `${base}${quote}=X`,
        displaySymbol: `${base}/${quote}`,
        baseCoin: base,
      };
    }
    const querySymbol = cleaned.endsWith('=X') ? cleaned : `${cleaned}=X`;
    return {
      querySymbol,
      displaySymbol: cleaned.replace(/=X$/i, ''),
      baseCoin: cleaned,
    };
  }

  if (category === 'crypto') {
    const stripped = cleaned.replace(/[-/]/g, '').replace(/USD$/, 'USDT');
    const baseCoin = stripped.endsWith('USDT')
      ? stripped.slice(0, -4)
      : stripped;
    const binanceSymbol = `${baseCoin}USDT`;
    return {
      querySymbol: binanceSymbol,
      displaySymbol: `${baseCoin}/USDT`,
      baseCoin,
    };
  }

  const stockSym = cleaned.replace(/\./g, '-');
  return {
    querySymbol: stockSym,
    displaySymbol: stockSym,
    baseCoin: stockSym,
  };
}

async function fetchYahooFinanceSeries(
  rawSymbol: string,
  category: 'stocks' | 'forex',
  fastScan: boolean
): Promise<RawMarketSeries> {
  const { querySymbol, displaySymbol } = normalizeTickerForCategory(
    rawSymbol,
    category
  );

  // 2003-01-01 still gives 24+ Annual (12M) bars (>=22 needed for 12M Jack_Minus1 & BB20)
  const chartResult = await yahooFinance.chart(querySymbol, {
    period1: fastScan ? '2003-01-01' : '2000-01-01',
    interval: '1d',
  });

  if (
    !chartResult ||
    !Array.isArray(chartResult.quotes) ||
    chartResult.quotes.length === 0
  ) {
    throw new Error(`No Yahoo Finance chart data returned for ${querySymbol}`);
  }

  const dailyBars: DailyOHLCV[] = [];
  for (const q of chartResult.quotes) {
    if (
      !q.date ||
      q.open === null ||
      q.high === null ||
      q.low === null ||
      q.close === null
    ) {
      continue;
    }
    const isoDate = new Date(q.date).toISOString().slice(0, 10);
    dailyBars.push({
      time: isoDate,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    });
  }

  const sanitized = sanitizeDailyBars(dailyBars);
  if (sanitized.length === 0) {
    throw new Error(`No valid OHLCV bars parsed for ${querySymbol}`);
  }

  const lastBar = sanitized[sanitized.length - 1];
  const prevBar =
    sanitized.length >= 2 ? sanitized[sanitized.length - 2] : lastBar;

  const metaPrice = Number(chartResult.meta?.regularMarketPrice);
  const livePrice =
    Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : lastBar.close;

  lastBar.close = livePrice;
  lastBar.high = Math.max(lastBar.high, livePrice);
  lastBar.low = Math.min(lastBar.low, livePrice);

  const computedChangePct =
    prevBar.close > 0 ? ((livePrice - prevBar.close) / prevBar.close) * 100 : 0;
  const metaChangePct = Number(chartResult.meta?.regularMarketChangePercent);
  const change24hPct = Number.isFinite(metaChangePct)
    ? metaChangePct
    : computedChangePct;

  const name =
    (typeof chartResult.meta?.shortName === 'string' &&
      chartResult.meta.shortName) ||
    (typeof chartResult.meta?.longName === 'string' &&
      chartResult.meta.longName) ||
    displaySymbol;

  return {
    symbol: querySymbol,
    displaySymbol,
    name,
    currency: chartResult.meta?.currency || 'USD',
    livePrice,
    change24hPct,
    source: 'yahoo-finance2',
    dailyBars: sanitized,
  };
}

async function fetchBinanceKlinesSeries(
  binanceSymbol: string,
  displaySymbol: string,
  baseCoin: string,
  fastScan: boolean
): Promise<RawMarketSeries> {
  const endpoints = [
    'https://data-api.binance.vision',
    'https://api.binance.com',
  ];

  let lastErr: unknown = null;
  const maxPages = fastScan ? 2 : 4; // 2000 days (~5.5y) on batch scan; 4000 days (~11y) on full chart

  for (const baseUrl of endpoints) {
    try {
      const allKlines: Array<
        [number, string, string, string, string, string]
      > = [];
      let endTime: number | null = null;

      for (let page = 0; page < maxPages; page++) {
        const qs = new URLSearchParams({
          symbol: binanceSymbol,
          interval: '1d',
          limit: '1000',
        });
        if (endTime !== null) {
          qs.set('endTime', String(endTime));
        }

        const res = await fetch(`${baseUrl}/api/v3/klines?${qs.toString()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        if (!res.ok) {
          if (page === 0) {
            throw new Error(`Binance HTTP ${res.status} for ${binanceSymbol}`);
          }
          break;
        }

        const batch = (await res.json()) as Array<
          [number, string, string, string, string, string]
        >;
        if (!Array.isArray(batch) || batch.length === 0) break;

        allKlines.push(...batch);
        const earliestOpenTime = Number(batch[0][0]);
        if (batch.length < 1000 || !Number.isFinite(earliestOpenTime)) {
          break;
        }
        endTime = earliestOpenTime - 1;
      }

      if (allKlines.length === 0) {
        throw new Error(`Empty Binance klines for ${binanceSymbol}`);
      }

      let livePriceFromTicker: number | null = null;
      let change24hFromTicker: number | null = null;

      if (!fastScan) {
        try {
          const tickerRes = await fetch(
            `${baseUrl}/api/v3/ticker/24hr?symbol=${encodeURIComponent(
              binanceSymbol
            )}`,
            { headers: { Accept: 'application/json' }, cache: 'no-store' }
          );
          if (tickerRes.ok) {
            const tData = (await tickerRes.json()) as {
              lastPrice?: string;
              priceChangePercent?: string;
            };
            const lp = Number(tData.lastPrice);
            const cp = Number(tData.priceChangePercent);
            if (Number.isFinite(lp) && lp > 0) livePriceFromTicker = lp;
            if (Number.isFinite(cp)) change24hFromTicker = cp;
          }
        } catch {
          // Latest 1d kline close already tracks live spot price
        }
      }

      const rawBars: DailyOHLCV[] = allKlines.map((k) => ({
        time: new Date(Number(k[0])).toISOString().slice(0, 10),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      }));

      const sanitized = sanitizeDailyBars(rawBars);
      const lastBar = sanitized[sanitized.length - 1];
      const prevBar =
        sanitized.length >= 2 ? sanitized[sanitized.length - 2] : lastBar;

      const livePrice = livePriceFromTicker ?? lastBar.close;
      lastBar.close = livePrice;
      lastBar.high = Math.max(lastBar.high, livePrice);
      lastBar.low = Math.min(lastBar.low, livePrice);

      const change24hPct =
        change24hFromTicker ??
        (prevBar.close > 0
          ? ((livePrice - prevBar.close) / prevBar.close) * 100
          : 0);

      return {
        symbol: binanceSymbol,
        displaySymbol,
        name: `${baseCoin} / USDT`,
        currency: 'USDT',
        livePrice,
        change24hPct,
        source: 'binance-rest',
        dailyBars: sanitized,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr ?? new Error(`Binance fetch failed for ${binanceSymbol}`);
}

async function fetchHyperliquidSeries(
  binanceSymbol: string,
  displaySymbol: string,
  baseCoin: string
): Promise<RawMarketSeries> {
  const now = Date.now();
  const startTime = now - 5000 * 86_400_000;

  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: {
        coin: baseCoin,
        interval: '1d',
        startTime,
        endTime: now,
      },
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Hyperliquid HTTP ${res.status} for ${baseCoin}`);
  }

  const candles = (await res.json()) as Array<{
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
  }>;

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`No Hyperliquid candles for ${baseCoin}`);
  }

  const sanitized = sanitizeDailyBars(
    candles.map((c) => ({
      time: new Date(Number(c.t)).toISOString().slice(0, 10),
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }))
  );

  const lastBar = sanitized[sanitized.length - 1];
  const prevBar =
    sanitized.length >= 2 ? sanitized[sanitized.length - 2] : lastBar;
  const livePrice = lastBar.close;
  const change24hPct =
    prevBar.close > 0 ? ((livePrice - prevBar.close) / prevBar.close) * 100 : 0;

  return {
    symbol: binanceSymbol,
    displaySymbol,
    name: `${baseCoin} Perp (Hyperliquid)`,
    currency: 'USD',
    livePrice,
    change24hPct,
    source: 'hyperliquid-rest',
    dailyBars: sanitized,
  };
}

const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  SUI: 'sui',
  TON: 'the-open-network',
  KAS: 'kaspa',
  OKB: 'okb',
  BSV: 'bitcoin-cash-sv',
};

async function fetchCoinGeckoSeries(
  binanceSymbol: string,
  displaySymbol: string,
  baseCoin: string
): Promise<RawMarketSeries> {
  const cgId = COINGECKO_ID_MAP[baseCoin] ?? baseCoin.toLowerCase();
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      cgId
    )}/ohlc?vs_currency=usd&days=365`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status} for ${cgId}`);
  }

  const data = (await res.json()) as Array<
    [number, number, number, number, number]
  >;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No CoinGecko OHLC data for ${cgId}`);
  }

  const sanitized = sanitizeDailyBars(
    data.map((row) => ({
      time: new Date(Number(row[0])).toISOString().slice(0, 10),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: 0,
    }))
  );

  const lastBar = sanitized[sanitized.length - 1];
  const prevBar =
    sanitized.length >= 2 ? sanitized[sanitized.length - 2] : lastBar;
  const livePrice = lastBar.close;
  const change24hPct =
    prevBar.close > 0 ? ((livePrice - prevBar.close) / prevBar.close) * 100 : 0;

  return {
    symbol: binanceSymbol,
    displaySymbol,
    name: `${baseCoin} / USD (CoinGecko)`,
    currency: 'USD',
    livePrice,
    change24hPct,
    source: 'coingecko-rest',
    dailyBars: sanitized,
  };
}

async function fetchCryptoSeries(
  rawSymbol: string,
  fastScan: boolean
): Promise<RawMarketSeries> {
  const { querySymbol, displaySymbol, baseCoin } = normalizeTickerForCategory(
    rawSymbol,
    'crypto'
  );

  try {
    return await fetchBinanceKlinesSeries(
      querySymbol,
      displaySymbol,
      baseCoin,
      fastScan
    );
  } catch {
    try {
      return await fetchHyperliquidSeries(querySymbol, displaySymbol, baseCoin);
    } catch {
      return await fetchCoinGeckoSeries(querySymbol, displaySymbol, baseCoin);
    }
  }
}

function trimVisualSeriesForTransport(
  tfData: TimeframeATSData,
  maxBars: number
): TimeframeATSData {
  if (tfData.bars.length <= maxBars) return tfData;

  const trimmedBars = tfData.bars.slice(-maxBars);
  const minTime = trimmedBars[0].time;

  return {
    ...tfData,
    bars: trimmedBars,
    bollingerBands: tfData.bollingerBands.filter((pt) => pt.time >= minTime),
    parabolicSAR: tfData.parabolicSAR.filter((pt) => pt.time >= minTime),
  };
}

const MAX_TRANSPORT_BARS: Record<Timeframe, number> = {
  D: 750,
  W: 360,
  M: 320,
  '3M': 160,
  '6M': 100,
  '12M': 60,
};

export async function buildMTFAssetPayload(
  rawSymbol: string,
  category: AssetCategory,
  options?: { fastScan?: boolean }
): Promise<MTFAssetPayload> {
  const fastScan = Boolean(options?.fastScan);
  const { querySymbol } = normalizeTickerForCategory(rawSymbol, category);
  const cacheKey = `${category}:${querySymbol}`;
  const now = Date.now();

  const cached = ephemeralCache.get(cacheKey);
  if (cached && cached.expiresAt > now && (fastScan || cached.isFullDepth)) {
    return cached.payload;
  }

  const rawSeries =
    category === 'crypto'
      ? await fetchCryptoSeries(rawSymbol, fastScan)
      : await fetchYahooFinanceSeries(rawSymbol, category, fastScan);

  const resampledBars = resampleAllTimeframes(rawSeries.dailyBars);

  const {
    timeframes: fullTimeframes,
    Didi,
    downsideDidi,
  } = computeAllTimeframesATS(resampledBars, rawSeries.livePrice);

  const screener = evaluateATSScreener({
    symbol: rawSeries.symbol,
    displaySymbol: rawSeries.displaySymbol,
    name: rawSeries.name,
    category,
    livePrice: rawSeries.livePrice,
    change24hPct: rawSeries.change24hPct,
    timeframes: fullTimeframes,
    Didi,
    downsideDidi,
  });

  const timeframes = {} as Record<Timeframe, TimeframeATSData>;
  for (const tf of ALL_TIMEFRAMES) {
    timeframes[tf] = trimVisualSeriesForTransport(
      fullTimeframes[tf],
      MAX_TRANSPORT_BARS[tf]
    );
  }

  const payload: MTFAssetPayload = {
    symbol: rawSeries.symbol,
    displaySymbol: rawSeries.displaySymbol,
    name: rawSeries.name,
    category,
    currency: rawSeries.currency,
    livePrice: rawSeries.livePrice,
    change24hPct: rawSeries.change24hPct,
    updatedAt: new Date().toISOString(),
    source: rawSeries.source,
    timeframes,
    Didi,
    downsideDidi,
    screener,
  };

  ephemeralCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    payload,
    isFullDepth: !fastScan,
  });

  return payload;
}
