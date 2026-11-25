import { NextRequest, NextResponse } from 'next/server';
import { buildMTFAssetPayload } from '@/lib/marketDataFetcher';
import { AssetCategory } from '@/types/ats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_CATEGORIES = new Set<AssetCategory>(['stocks', 'crypto', 'forex']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim();
  const rawCategory = (searchParams.get('category') || 'stocks')
    .trim()
    .toLowerCase() as AssetCategory;

  if (!symbol) {
    return NextResponse.json(
      { error: 'Missing required query parameter: symbol' },
      { status: 400 }
    );
  }

  const category: AssetCategory = VALID_CATEGORIES.has(rawCategory)
    ? rawCategory
    : 'stocks';

  try {
    const payload = await buildMTFAssetPayload(symbol, category);

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch market data';
    return NextResponse.json(
      { error: message, symbol, category },
      { status: 502 }
    );
  }
}
