import { NextRequest, NextResponse } from 'next/server';
import { compareScreenerResults } from '@/lib/atsScreener';
import { buildMTFAssetPayload } from '@/lib/marketDataFetcher';
import type { AssetCategory, ScreenerResult } from '@/types/ats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_CATEGORIES = new Set<AssetCategory>(['stocks', 'crypto', 'forex']);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        const value = await worker(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawSymbols = searchParams.get('symbols') || '';
  const rawCategory = (searchParams.get('category') || 'stocks')
    .trim()
    .toLowerCase() as AssetCategory;

  const category: AssetCategory = VALID_CATEGORIES.has(rawCategory)
    ? rawCategory
    : 'stocks';

  // Up to 35 tickers per stateless chunk (client streams 25-ticker batches for 500+ universes)
  const symbols = Array.from(
    new Set(
      rawSymbols
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, 35);

  if (symbols.length === 0) {
    return NextResponse.json({ results: [], errors: [] });
  }

  const concurrency = category === 'crypto' ? 8 : 6;
  const settled = await mapWithConcurrency(symbols, concurrency, async (sym) => {
    const payload = await buildMTFAssetPayload(sym, category, {
      fastScan: true,
    });
    return payload.screener;
  });

  const results: ScreenerResult[] = [];
  const errors: Array<{ symbol: string; error: string }> = [];

  settled.forEach((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      errors.push({
        symbol: symbols[idx],
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : 'Unknown fetch error',
      });
    }
  });

  results.sort((a, b) => compareScreenerResults(a, b, 'STATE'));

  return NextResponse.json(
    {
      category,
      scannedAt: new Date().toISOString(),
      results,
      errors,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=180',
      },
    }
  );
}
