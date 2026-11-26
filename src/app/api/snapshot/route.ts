import { NextRequest, NextResponse } from 'next/server';
import type { AssetCategory } from '@/types/ats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const VALID_CATEGORIES = new Set<AssetCategory>(['stocks', 'crypto', 'forex']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawCategory = (searchParams.get('category') || 'stocks')
    .trim()
    .toLowerCase() as AssetCategory;
  const forceFresh = searchParams.get('fresh') === '1';

  const category: AssetCategory = VALID_CATEGORIES.has(rawCategory)
    ? rawCategory
    : 'stocks';

  const repo = process.env.GITHUB_SCAN_REPO || 'smartcontrart/ATStracker';
  const branch = process.env.GITHUB_SCAN_BRANCH || 'scan-data';
  const token = process.env.GITHUB_SCAN_TOKEN || process.env.GITHUB_TOKEN || '';

  const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${category}.json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'ATS-Screener-Snapshot-Client',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(rawUrl, {
      headers,
      signal: controller.signal,
      cache: forceFresh ? 'no-store' : 'default',
    });

    if (res.status === 404) {
      return NextResponse.json(
        {
          available: false,
          reason: token
            ? 'snapshot_not_generated_yet'
            : 'snapshot_not_found_or_private_repo',
          category,
          results: [],
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'public, s-maxage=30' },
        }
      );
    }

    if (!res.ok) {
      throw new Error(`Upstream snapshot HTTP ${res.status}`);
    }

    const json = await res.json();

    return NextResponse.json(
      {
        available: true,
        ...json,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': forceFresh
            ? 'no-store'
            : 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        reason: err instanceof Error ? err.message : 'snapshot_fetch_error',
        category,
        results: [],
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}
