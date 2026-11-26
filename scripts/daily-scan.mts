/**
 * Daily Post-Close ATS Screener Snapshot Builder (runs on Node 22+ in GitHub Actions).
 *
 * 1. Fetches official up-to-date constituents for:
 *    - Russell 2000 (iShares IWM CSV)
 *    - STOXX Europe 600 (iShares EXSA CSV, mapped to exact Yahoo Finance suffixes)
 *    - Plus S&P 500 + 14 Thématiques AT.S + Top 100 Crypto + Top 50 FX.
 * 2. Evaluates every symbol using the exact same `buildMTFAssetPayload` + `atsScreener`
 *    engine used by the live web app.
 * 3. Writes compact JSON snapshots (`stocks.json`, `crypto.json`, `forex.json`, `meta.json`)
 *    ready to publish to the `scan-data` branch for instant (<0.3s) app loading.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_THEMATIC_TICKERS,
  RUSSELL_2000_FALLBACK_TICKERS,
  STOXX_600_FALLBACK_TICKERS,
  THEMATIC_STOCK_LISTS,
  TOP_100_CRYPTO_TICKERS,
  TOP_50_FOREX_TICKERS,
  UNIQUE_SP500_TICKERS,
} from '../src/lib/assetUniverses.ts';
import { compareScreenerResults } from '../src/lib/atsScreener.ts';
import { buildMTFAssetPayload } from '../src/lib/marketDataFetcher.ts';
import type { AssetCategory, ScreenerResult } from '../src/types/ats.ts';

interface SnapshotPayload {
  category: AssetCategory;
  scannedAt: string;
  totalAttempted: number;
  totalScanned: number;
  activeSetupCount: number;
  failedCount: number;
  universes: Record<string, string[]>;
  results: ScreenerResult[];
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/csv,text/plain,text/html,*/*',
};

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eqIdx = token.indexOf('=');
    if (eqIdx > 0) {
      args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[token.slice(2)] = argv[++i];
    } else {
      args[token.slice(2)] = true;
    }
  }
  return args;
}

/** RFC-4180 aware single CSV line splitter (handles quoted fields containing commas). */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseISharesCSVRows(csvText: string): Array<Record<string, string>> {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);

  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cols = parseCSVLine(lines[i]);
    const lower = cols.map((c) => c.toLowerCase());
    if (
      (lower.includes('ticker') || lower.includes('emittententicker')) &&
      (lower.includes('asset class') ||
        lower.includes('anlageklasse') ||
        lower.includes('exchange') ||
        lower.includes('börse') ||
        lower.includes('name'))
    ) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }

  if (headerIdx < 0) return [];

  const rows: Array<Record<string, string>> = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 2) continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      rec[headers[c]] = cols[c] ?? '';
    }
    rows.push(rec);
  }
  return rows;
}

async function fetchTextWithTimeout(url: string, timeoutMs = 25_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchISharesCSVWithAutoDiscovery(
  directUrls: string[],
  productPageUrls: string[],
  label: string
): Promise<Array<Record<string, string>>> {
  for (const url of directUrls) {
    try {
      const text = await fetchTextWithTimeout(url);
      const rows = parseISharesCSVRows(text);
      if (rows.length >= 100) {
        console.log(`[constituents] ${label}: fetched ${rows.length} rows via direct CSV`);
        return rows;
      }
    } catch (err) {
      console.warn(
        `[constituents] ${label} direct URL failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  for (const pageUrl of productPageUrls) {
    try {
      const html = await fetchTextWithTimeout(pageUrl);
      const match = html.match(
        /href="([^"]*\.ajax\?fileType=csv[^"]*dataType=fund[^"]*)"/i
      );
      if (match?.[1]) {
        const discovered = match[1].startsWith('http')
          ? match[1]
          : `https://www.ishares.com${match[1]}`;
        const text = await fetchTextWithTimeout(discovered.replace(/&amp;/g, '&'));
        const rows = parseISharesCSVRows(text);
        if (rows.length >= 100) {
          console.log(
            `[constituents] ${label}: fetched ${rows.length} rows via auto-discovered CSV`
          );
          return rows;
        }
      }
    } catch (err) {
      console.warn(
        `[constituents] ${label} auto-discovery failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return [];
}

function getField(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  const lowerEntries = Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]);
  for (const k of keys) {
    const found = lowerEntries.find(([lk]) => lk === k.toLowerCase());
    if (found && found[1]) return found[1];
  }
  return '';
}

function isEquityRow(row: Record<string, string>): boolean {
  const assetClass = getField(row, ['Asset Class', 'Anlageklasse']).toLowerCase();
  if (!assetClass) return true;
  return assetClass.includes('equity') || assetClass.includes('aktien');
}

function normalizeUSTicker(raw: string): string | null {
  const clean = raw.trim().toUpperCase();
  if (!clean || clean === '-' || clean === 'N/A') return null;
  if (/^(USD|EUR|GBP|CAD|CHF|JPY|CASH|XTSLA|SGAFT|MSFUT|RTY)/.test(clean)) {
    return null;
  }
  // Convert share classes like BRK.B / MOG.A / CWEN.A -> BRK-B / MOG-A / CWEN-A
  const normalized = clean
    .replace(/\s+/g, '-')
    .replace(/^([A-Z0-9]+)\.([A-Z])$/, '$1-$2');
  if (!/^[A-Z]{1,5}(-[A-Z])?$/.test(normalized)) return null;
  return normalized;
}

function mapEuropeanExchangeToYahooSuffix(exchange: string, location: string): string | null {
  const ex = exchange.toLowerCase();
  const loc = location.toLowerCase();

  if (ex.includes('xetra') || ex.includes('frankfurt') || ex.includes('deutsche boerse')) return '.DE';
  if (ex.includes('london')) return '.L';
  if (ex.includes('paris')) return '.PA';
  if (ex.includes('swiss') || ex.includes('six')) return '.SW';
  if (ex.includes('amsterdam')) return '.AS';
  if (ex.includes('italiana') || ex.includes('milan')) return '.MI';
  if (ex.includes('madrid') || ex.includes('espanol') || ex.includes('bolsa de madrid')) return '.MC';
  if (ex.includes('stockholm')) return '.ST';
  if (ex.includes('copenhagen') || ex.includes('kopenhagen')) return '.CO';
  if (ex.includes('oslo')) return '.OL';
  if (ex.includes('helsinki')) return '.HE';
  if (ex.includes('brussels') || ex.includes('brüssel')) return '.BR';
  if (ex.includes('wiener') || ex.includes('vienna') || ex.includes('wien')) return '.VI';
  if (ex.includes('irish') || ex.includes('dublin')) return '.IR';
  if (ex.includes('lisbon') || ex.includes('lissabon')) return '.LS';
  if (ex.includes('warsaw') || ex.includes('warschau')) return '.WA';
  if (ex.includes('nyse') || ex.includes('nasdaq')) {
    if (loc.includes('united states')) return '';
  }

  // Fallback on Location column
  if (loc.includes('germany') || loc.includes('deutschland')) return '.DE';
  if (loc.includes('united kingdom') || loc.includes('vereinigtes')) return '.L';
  if (loc.includes('france') || loc.includes('frankreich')) return '.PA';
  if (loc.includes('switzerland') || loc.includes('schweiz')) return '.SW';
  if (loc.includes('netherlands') || loc.includes('niederlande')) return '.AS';
  if (loc.includes('italy') || loc.includes('italien')) return '.MI';
  if (loc.includes('spain') || loc.includes('spanien')) return '.MC';
  if (loc.includes('sweden') || loc.includes('schweden')) return '.ST';
  if (loc.includes('denmark') || loc.includes('dänemark')) return '.CO';
  if (loc.includes('norway') || loc.includes('norwegen')) return '.OL';
  if (loc.includes('finland') || loc.includes('finnland')) return '.HE';
  if (loc.includes('belgium') || loc.includes('belgien')) return '.BR';
  if (loc.includes('austria') || loc.includes('österreich')) return '.VI';
  if (loc.includes('ireland') || loc.includes('irland')) return '.IR';
  if (loc.includes('portugal')) return '.LS';
  if (loc.includes('poland') || loc.includes('polen')) return '.WA';

  return null;
}

function normalizeEuropeanTicker(
  rawTicker: string,
  exchange: string,
  location: string
): string | null {
  const clean = rawTicker.trim().toUpperCase();
  if (!clean || clean === '-' || clean === 'N/A') return null;
  if (/^(EUR|USD|GBP|CHF|SEK|DKK|NOK|PLN|CASH)/.test(clean)) return null;

  // Already has a Yahoo suffix like .PA / .DE / .L
  if (/\.(PA|DE|L|SW|AS|MI|MC|ST|CO|OL|HE|BR|VI|IR|LS|WA)$/.test(clean)) {
    return clean;
  }

  const suffix = mapEuropeanExchangeToYahooSuffix(exchange, location);
  if (suffix === null) return null;

  // Clean local ticker conventions:
  // - UK trailing dot: "RR." -> "RR", "BA." -> "BA", "BT.A" -> "BT-A"
  // - Nordic / Swiss share classes with spaces or dots: "VOLV B" -> "VOLV-B", "NOVO B" -> "NOVO-B", "ROG.S" -> "ROG"
  let base = clean
    .replace(/\.$/, '')
    .replace(/\s+/g, '-')
    .replace(/^([A-Z0-9]+)\.([A-Z0-9]{1,2})$/, '$1-$2')
    .replace(/[^A-Z0-9-]/g, '');

  if (!base || base.length > 12) return null;
  return `${base}${suffix}`;
}

async function resolveRussell2000Tickers(prevUniverses?: Record<string, string[]>): Promise<string[]> {
  const rows = await fetchISharesCSVWithAutoDiscovery(
    [
      'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund',
    ],
    ['https://www.ishares.com/us/products/239710/ishares-russell-2000-etf'],
    'Russell 2000 (IWM)'
  );

  const tickers = new Set<string>();
  for (const row of rows) {
    if (!isEquityRow(row)) continue;
    const raw = getField(row, ['Ticker', 'Emittententicker']);
    const norm = normalizeUSTicker(raw);
    if (norm) tickers.add(norm);
  }

  if (tickers.size >= 500) {
    console.log(`[constituents] Russell 2000 resolved: ${tickers.size} unique tickers`);
    return Array.from(tickers);
  }

  if (prevUniverses?.russell2000 && prevUniverses.russell2000.length >= 200) {
    console.warn(
      `[constituents] Using previous scan-data Russell 2000 list (${prevUniverses.russell2000.length} tickers)`
    );
    return prevUniverses.russell2000;
  }

  console.warn(
    `[constituents] Falling back to built-in Russell 2000 core list (${RUSSELL_2000_FALLBACK_TICKERS.length} tickers)`
  );
  return RUSSELL_2000_FALLBACK_TICKERS;
}

async function resolveStoxx600Tickers(prevUniverses?: Record<string, string[]>): Promise<string[]> {
  const rows = await fetchISharesCSVWithAutoDiscovery(
    [
      'https://www.ishares.com/uk/individual/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1506575576011.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund',
      'https://www.ishares.com/de/privatanleger/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1478358465952.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund',
    ],
    [
      'https://www.ishares.com/uk/individual/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de-fund',
      'https://www.ishares.com/de/privatanleger/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de-fund',
    ],
    'STOXX Europe 600 (EXSA)'
  );

  const tickers = new Set<string>();
  for (const row of rows) {
    if (!isEquityRow(row)) continue;
    const raw = getField(row, ['Ticker', 'Emittententicker']);
    const exchange = getField(row, ['Exchange', 'Börse']);
    const location = getField(row, ['Location', 'Standort']);
    const norm = normalizeEuropeanTicker(raw, exchange, location);
    if (norm) tickers.add(norm);
  }

  if (tickers.size >= 300) {
    console.log(`[constituents] STOXX Europe 600 resolved: ${tickers.size} unique tickers`);
    return Array.from(tickers);
  }

  if (prevUniverses?.stoxx600 && prevUniverses.stoxx600.length >= 200) {
    console.warn(
      `[constituents] Using previous scan-data STOXX 600 list (${prevUniverses.stoxx600.length} tickers)`
    );
    return prevUniverses.stoxx600;
  }

  console.warn(
    `[constituents] Falling back to built-in STOXX Europe 600 core list (${STOXX_600_FALLBACK_TICKERS.length} tickers)`
  );
  return STOXX_600_FALLBACK_TICKERS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scanCategory(params: {
  category: AssetCategory;
  symbols: string[];
  universes: Record<string, string[]>;
  concurrency: number;
}): Promise<SnapshotPayload> {
  const { category, symbols, universes, concurrency } = params;
  const startedAt = Date.now();
  console.log(
    `\n=== Scanning ${category.toUpperCase()} (${symbols.length} symbols, concurrency=${concurrency}) ===`
  );

  const results: ScreenerResult[] = [];
  let cursor = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (cursor < symbols.length) {
      const idx = cursor++;
      const sym = symbols[idx];
      let success = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const payload = await buildMTFAssetPayload(sym, category, {
            fastScan: true,
          });
          results.push(payload.screener);
          success = true;
          break;
        } catch {
          if (attempt === 0) {
            await sleep(1200 + Math.random() * 600);
          }
        }
      }

      if (!success) failed++;
      completed++;

      if (completed % 100 === 0 || completed === symbols.length) {
        const activeCount = results.filter(
          (r) =>
            r.atsState === 'STEP 1: THE WALL' ||
            r.atsState === 'STEP 2: REVERSAL CONFIRMED'
        ).length;
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `[${category}] ${completed}/${symbols.length} (${elapsedSec}s) | ok=${results.length} | active=${activeCount} | skipped=${failed}`
        );
      }

      await sleep(35);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, symbols.length) },
    () => worker()
  );
  await Promise.all(runners);

  results.sort((a, b) => compareScreenerResults(a, b, 'STATE'));

  const activeSetupCount = results.filter(
    (r) =>
      r.atsState === 'STEP 1: THE WALL' ||
      r.atsState === 'STEP 2: REVERSAL CONFIRMED'
  ).length;

  return {
    category,
    scannedAt: new Date().toISOString(),
    totalAttempted: symbols.length,
    totalScanned: results.length,
    activeSetupCount,
    failedCount: failed,
    universes,
    results,
  };
}

function readPreviousUniverses(prevDir: string | null): Record<string, string[]> | undefined {
  if (!prevDir) return undefined;
  try {
    const file = path.join(prevDir, 'stocks.json');
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.universes === 'object') {
      return parsed.universes as Record<string, string[]>;
    }
  } catch {
    // Non-fatal
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(
    typeof args.out === 'string' ? args.out : 'scan-output'
  );
  const prevDir =
    typeof args.prev === 'string' ? path.resolve(args.prev) : null;
  const limit =
    typeof args.limit === 'string' ? Math.max(1, Number(args.limit)) : null;
  const concurrency =
    typeof args.concurrency === 'string'
      ? Math.max(1, Math.min(12, Number(args.concurrency)))
      : 6;
  const skipConstituents = Boolean(args['skip-constituents']);
  const requestedCategories = (
    typeof args.categories === 'string'
      ? args.categories.split(',')
      : ['stocks', 'crypto', 'forex']
  )
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is AssetCategory =>
      c === 'stocks' || c === 'crypto' || c === 'forex'
    );

  fs.mkdirSync(outDir, { recursive: true });

  const meta: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    categories: {},
  };

  if (requestedCategories.includes('stocks')) {
    const prevUniverses = readPreviousUniverses(prevDir);
    const [stoxx600, russell2000] = skipConstituents
      ? [STOXX_600_FALLBACK_TICKERS, RUSSELL_2000_FALLBACK_TICKERS]
      : await Promise.all([
          resolveStoxx600Tickers(prevUniverses),
          resolveRussell2000Tickers(prevUniverses),
        ]);

    const universes: Record<string, string[]> = {
      sp500: UNIQUE_SP500_TICKERS,
      stoxx600,
      russell2000,
      thematic_all: ALL_THEMATIC_TICKERS,
    };
    for (const sector of Object.values(THEMATIC_STOCK_LISTS)) {
      universes[sector.id] = sector.tickers;
    }

    let allStocks = Array.from(
      new Set([
        ...ALL_THEMATIC_TICKERS,
        ...UNIQUE_SP500_TICKERS,
        ...stoxx600,
        ...russell2000,
      ])
    );
    if (limit) allStocks = allStocks.slice(0, limit);

    const stocksSnap = await scanCategory({
      category: 'stocks',
      symbols: allStocks,
      universes,
      concurrency,
    });
    fs.writeFileSync(
      path.join(outDir, 'stocks.json'),
      JSON.stringify(stocksSnap)
    );
    (meta.categories as Record<string, unknown>).stocks = {
      scannedAt: stocksSnap.scannedAt,
      totalScanned: stocksSnap.totalScanned,
      activeSetupCount: stocksSnap.activeSetupCount,
      failedCount: stocksSnap.failedCount,
      universeCounts: {
        sp500: UNIQUE_SP500_TICKERS.length,
        stoxx600: stoxx600.length,
        russell2000: russell2000.length,
        thematic_all: ALL_THEMATIC_TICKERS.length,
      },
    };
  }

  if (requestedCategories.includes('crypto')) {
    const syms = limit
      ? TOP_100_CRYPTO_TICKERS.slice(0, limit)
      : TOP_100_CRYPTO_TICKERS;
    const cryptoSnap = await scanCategory({
      category: 'crypto',
      symbols: syms,
      universes: { top100: TOP_100_CRYPTO_TICKERS },
      concurrency: Math.min(8, concurrency + 2),
    });
    fs.writeFileSync(
      path.join(outDir, 'crypto.json'),
      JSON.stringify(cryptoSnap)
    );
    (meta.categories as Record<string, unknown>).crypto = {
      scannedAt: cryptoSnap.scannedAt,
      totalScanned: cryptoSnap.totalScanned,
      activeSetupCount: cryptoSnap.activeSetupCount,
      failedCount: cryptoSnap.failedCount,
    };
  }

  if (requestedCategories.includes('forex')) {
    const syms = limit
      ? TOP_50_FOREX_TICKERS.slice(0, limit)
      : TOP_50_FOREX_TICKERS;
    const forexSnap = await scanCategory({
      category: 'forex',
      symbols: syms,
      universes: { top50: TOP_50_FOREX_TICKERS },
      concurrency,
    });
    fs.writeFileSync(
      path.join(outDir, 'forex.json'),
      JSON.stringify(forexSnap)
    );
    (meta.categories as Record<string, unknown>).forex = {
      scannedAt: forexSnap.scannedAt,
      totalScanned: forexSnap.totalScanned,
      activeSetupCount: forexSnap.activeSetupCount,
      failedCount: forexSnap.failedCount,
    };
  }

  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );
  console.log('\n=== Daily ATS Scan Complete ===');
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error('Fatal daily scan error:', err);
  process.exit(1);
});
