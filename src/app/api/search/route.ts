import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import {
  MASTER_STOCKS_UNIVERSE,
  TOP_50_FOREX_TICKERS,
  TOP_100_CRYPTO_TICKERS,
} from '@/lib/assetUniverses';
import { normalizeTickerForCategory } from '@/lib/marketDataFetcher';
import type { AssetCategory } from '@/types/ats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

export interface AssetSearchItem {
  symbol: string;
  displaySymbol: string;
  name: string;
  category: AssetCategory;
  exchange: string;
  typeLabel: string;
}

const ISO_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD',
  'CNH', 'CNY', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'MXN', 'BRL', 'CLP',
  'COP', 'PEN', 'INR', 'KRW', 'TWD', 'THB', 'IDR', 'MYR',
  'PHP', 'ILS', 'SAR', 'AED',
]);

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  CHF: 'Swiss Franc',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  NZD: 'New Zealand Dollar',
  CNH: 'Chinese Yuan (Offshore)',
  HKD: 'Hong Kong Dollar',
  SGD: 'Singapore Dollar',
  SEK: 'Swedish Krona',
  NOK: 'Norwegian Krone',
  DKK: 'Danish Krone',
  PLN: 'Polish Zloty',
  CZK: 'Czech Koruna',
  HUF: 'Hungarian Forint',
  TRY: 'Turkish Lira',
  ZAR: 'South African Rand',
  MXN: 'Mexican Peso',
  BRL: 'Brazilian Real',
  INR: 'Indian Rupee',
  KRW: 'South Korean Won',
  TWD: 'Taiwan Dollar',
  THB: 'Thai Baht',
  ILS: 'Israeli Shekel',
};

const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  BNB: 'BNB',
  SOL: 'Solana',
  XRP: 'XRP (Ripple)',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  TRX: 'TRON',
  AVAX: 'Avalanche',
  SHIB: 'Shiba Inu',
  TON: 'Toncoin',
  LINK: 'Chainlink',
  DOT: 'Polkadot',
  BCH: 'Bitcoin Cash',
  NEAR: 'NEAR Protocol',
  SUI: 'Sui',
  LTC: 'Litecoin',
  APT: 'Aptos',
  UNI: 'Uniswap',
  PEPE: 'Pepe',
  ICP: 'Internet Computer',
  FET: 'Artificial Superintelligence',
  ETC: 'Ethereum Classic',
  RENDER: 'Render',
  KAS: 'Kaspa',
  TAO: 'Bittensor',
  STX: 'Stacks',
  XLM: 'Stellar',
  HBAR: 'Hedera',
  ATOM: 'Cosmos',
  FIL: 'Filecoin',
  ARBUSDT: 'Arbitrum',
  ARB: 'Arbitrum',
  WIF: 'dogwifhat',
  OP: 'Optimism',
  INJ: 'Injective',
  AAVE: 'Aave',
  TIA: 'Celestia',
  PYTH: 'Pyth Network',
  JUP: 'Jupiter',
  LDO: 'Lido DAO',
  PENDLE: 'Pendle',
  WLD: 'Worldcoin',
  ENA: 'Ethena',
  ONDO: 'Ondo Finance',
  HYPE: 'Hyperliquid',
};

function buildLocalMatches(rawQuery: string): AssetSearchItem[] {
  const q = rawQuery.trim().toUpperCase();
  if (!q) return [];

  const matches: AssetSearchItem[] = [];
  const alphaOnly = q.replace(/[^A-Z0-9]/g, '');

  // 1. Direct 6-letter ISO Forex Pair detection (e.g., "EUR/USD", "EURUSD", "USDZAR", "GBP/JPY")
  const fxLetters = q.replace(/=X$/i, '').replace(/[^A-Z]/g, '');
  if (fxLetters.length === 6) {
    const base = fxLetters.slice(0, 3);
    const quote = fxLetters.slice(3, 6);
    if (ISO_CURRENCIES.has(base) && ISO_CURRENCIES.has(quote) && base !== quote) {
      const baseName = CURRENCY_NAMES[base] || base;
      const quoteName = CURRENCY_NAMES[quote] || quote;
      matches.push({
        symbol: `${base}${quote}=X`,
        displaySymbol: `${base}/${quote}`,
        name: `${baseName} / ${quoteName}`,
        category: 'forex',
        exchange: 'FX Spot',
        typeLabel: 'Forex Pair',
      });
    }
  }

  // 2. Match against Top 50 Forex Pairs by code or currency name
  for (const fxSym of TOP_50_FOREX_TICKERS) {
    const cleanPair = fxSym.replace(/=X$/, '');
    const base = cleanPair.slice(0, 3);
    const quote = cleanPair.slice(3, 6);
    const pairLabel = `${base}/${quote}`;
    const fullDesc = `${CURRENCY_NAMES[base] || base} / ${
      CURRENCY_NAMES[quote] || quote
    }`;

    if (
      cleanPair.includes(alphaOnly) ||
      pairLabel.includes(q) ||
      fullDesc.toUpperCase().includes(q)
    ) {
      matches.push({
        symbol: fxSym,
        displaySymbol: pairLabel,
        name: fullDesc,
        category: 'forex',
        exchange: 'FX Spot',
        typeLabel: 'Forex Pair',
      });
    }
  }

  // 3. Match against Top 100 Cryptos (+ HYPE) by ticker or coin name
  const cryptoPool = Array.from(
    new Set(['HYPEUSDT', ...TOP_100_CRYPTO_TICKERS])
  );
  for (const cSym of cryptoPool) {
    const base = cSym.replace(/USDT$/, '');
    const coinName = CRYPTO_NAMES[base] || base;
    if (
      base === alphaOnly ||
      cSym.startsWith(alphaOnly) ||
      coinName.toUpperCase().includes(q)
    ) {
      matches.push({
        symbol: cSym,
        displaySymbol: `${base}/USDT`,
        name: `${coinName} (${base})`,
        category: 'crypto',
        exchange: base === 'HYPE' ? 'Hyperliquid' : 'Binance / Spot',
        typeLabel: 'Crypto',
      });
    }
  }

  // 4. Exact / prefix Tracked Stock Universe matches (S&P 500 + 14 AT.S Thematic Lists)
  for (const sSym of MASTER_STOCKS_UNIVERSE) {
    if (sSym === q || sSym.startsWith(q)) {
      matches.push({
        symbol: sSym,
        displaySymbol: sSym,
        name: `${sSym} (Tracked Universe)`,
        category: 'stocks',
        exchange: 'US Equity',
        typeLabel: 'Stock / ETF',
      });
    }
  }

  return matches;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const localItems = buildLocalMatches(query);
  const remoteItems: AssetSearchItem[] = [];

  try {
    const yfSearch = await yahooFinance.search(query, {
      quotesCount: 14,
      newsCount: 0,
    });

    if (yfSearch && Array.isArray(yfSearch.quotes)) {
      for (const quote of yfSearch.quotes) {
        if (!('isYahooFinance' in quote) || !quote.isYahooFinance) continue;
        if (!quote.symbol || !('quoteType' in quote)) continue;

        const qType = quote.quoteType;
        const name = quote.shortname || quote.longname || quote.symbol;
        const exchange = quote.exchDisp || quote.exchange || '';

        if (qType === 'EQUITY' || qType === 'ETF' || qType === 'INDEX') {
          // Skip obscure option-like or warrant suffixes unless directly queried
          remoteItems.push({
            symbol: quote.symbol,
            displaySymbol: quote.symbol,
            name,
            category: 'stocks',
            exchange,
            typeLabel: qType === 'ETF' ? 'ETF' : qType === 'INDEX' ? 'Index' : 'Stock',
          });
        } else if (qType === 'CURRENCY') {
          const norm = normalizeTickerForCategory(quote.symbol, 'forex');
          remoteItems.push({
            symbol: norm.querySymbol,
            displaySymbol: norm.displaySymbol,
            name,
            category: 'forex',
            exchange: exchange || 'FX',
            typeLabel: 'Forex Pair',
          });
        } else if (qType === 'CRYPTOCURRENCY') {
          const base = quote.symbol.split('-')[0] || quote.symbol;
          const norm = normalizeTickerForCategory(base, 'crypto');
          remoteItems.push({
            symbol: norm.querySymbol,
            displaySymbol: norm.displaySymbol,
            name,
            category: 'crypto',
            exchange: 'Crypto Spot',
            typeLabel: 'Crypto',
          });
        }
      }
    }
  } catch {
    // Graceful degradation: local dictionary + direct ticker lookup still work
  }

  // Merge and deduplicate (preferring Yahoo's full company name over generic S&P 500 placeholder)
  const mergedMap = new Map<string, AssetSearchItem>();

  for (const item of [...remoteItems, ...localItems]) {
    const key = `${item.category}:${item.symbol}`;
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, item);
    } else if (
      existing.name.includes('Tracked Universe') &&
      !item.name.includes('Tracked Universe')
    ) {
      mergedMap.set(key, item);
    }
  }

  const upperQ = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const results = Array.from(mergedMap.values())
    .sort((a, b) => {
      const aSymClean = a.displaySymbol.replace(/[^A-Z0-9]/g, '');
      const bSymClean = b.displaySymbol.replace(/[^A-Z0-9]/g, '');
      const aExact = aSymClean === upperQ || a.symbol.replace(/=X$|USDT$/, '') === upperQ ? 1 : 0;
      const bExact = bSymClean === upperQ || b.symbol.replace(/=X$|USDT$/, '') === upperQ ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aStarts = aSymClean.startsWith(upperQ) ? 1 : 0;
      const bStarts = bSymClean.startsWith(upperQ) ? 1 : 0;
      return bStarts - aStarts;
    })
    .slice(0, 18);

  return NextResponse.json(
    { results },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    }
  );
}
