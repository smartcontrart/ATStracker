import { NextRequest, NextResponse } from 'next/server';
import type { AssetCategory } from '@/types/ats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const VALID_CATEGORIES = new Set<AssetCategory>(['stocks', 'crypto', 'forex']);

interface GitTreeEntry {
  path: string;
  sha: string;
  type: string;
}

/**
 * Fetches `${category}.json` from the `scan-data` branch.
 * - When `GITHUB_SCAN_TOKEN` (fine-grained `Contents: Read-only` PAT or classic token) is set,
 *   uses the official GitHub Git Trees + Git Blobs REST API (`application/vnd.github.raw+json`),
 *   which reliably supports private repos AND files up to 100 MB.
 * - For public repos without a token, tries `raw.githubusercontent.com` first, then `api.github.com`.
 */
async function fetchSnapshotText(params: {
  repo: string;
  branch: string;
  fileName: string;
  token: string;
  signal: AbortSignal;
  forceFresh: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const { repo, branch, fileName, token, signal, forceFresh } = params;

  const fetchViaGitHubApi = async (): Promise<
    { ok: true; text: string } | { ok: false; reason: string }
  > => {
    const apiHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ATS-Screener-Snapshot-Client',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      apiHeaders.Authorization = `Bearer ${token}`;
    }

    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(
      branch
    )}`;
    const treeRes = await fetch(treeUrl, {
      headers: apiHeaders,
      signal,
      cache: forceFresh ? 'no-store' : 'default',
    });

    if (treeRes.status === 404) {
      return {
        ok: false,
        reason: token
          ? `branch_or_repo_not_found (${repo}@${branch})`
          : `repo_private_or_branch_missing (add GITHUB_SCAN_TOKEN in Vercel)`,
      };
    }
    if (treeRes.status === 401 || treeRes.status === 403) {
      return {
        ok: false,
        reason: `github_token_unauthorized (HTTP ${treeRes.status} — ensure Contents: Read-only on ${repo})`,
      };
    }
    if (!treeRes.ok) {
      return { ok: false, reason: `github_tree_http_${treeRes.status}` };
    }

    const treeJson = (await treeRes.json()) as { tree?: GitTreeEntry[] };
    const entry = (treeJson.tree || []).find((e) => e.path === fileName);
    if (!entry?.sha) {
      return { ok: false, reason: `file_${fileName}_not_in_${branch}` };
    }

    const blobUrl = `https://api.github.com/repos/${repo}/git/blobs/${entry.sha}`;
    const blobRes = await fetch(blobUrl, {
      headers: {
        ...apiHeaders,
        Accept: 'application/vnd.github.raw+json',
      },
      signal,
      cache: forceFresh ? 'no-store' : 'default',
    });

    if (!blobRes.ok) {
      return { ok: false, reason: `github_blob_http_${blobRes.status}` };
    }

    const text = await blobRes.text();
    return { ok: true, text };
  };

  const fetchViaRawUrl = async (): Promise<
    { ok: true; text: string } | { ok: false; reason: string }
  > => {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${fileName}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'ATS-Screener-Snapshot-Client',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(rawUrl, {
      headers,
      signal,
      cache: forceFresh ? 'no-store' : 'default',
    });
    if (!res.ok) {
      return { ok: false, reason: `raw_http_${res.status}` };
    }
    return { ok: true, text: await res.text() };
  };

  if (token) {
    // Official GitHub REST API first for private repos & fine-grained PATs
    const apiResult = await fetchViaGitHubApi();
    if (apiResult.ok) return apiResult;
    const rawResult = await fetchViaRawUrl();
    return rawResult.ok ? rawResult : apiResult;
  }

  // Public repo: raw.githubusercontent.com first, fallback to GitHub API
  const rawResult = await fetchViaRawUrl();
  if (rawResult.ok) return rawResult;
  return await fetchViaGitHubApi();
}

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
  const token = (
    process.env.GITHUB_SCAN_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ''
  ).trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);

  try {
    const fetched = await fetchSnapshotText({
      repo,
      branch,
      fileName: `${category}.json`,
      token,
      signal: controller.signal,
      forceFresh,
    });

    if (!fetched.ok) {
      return NextResponse.json(
        {
          available: false,
          reason: fetched.reason,
          hasToken: Boolean(token),
          category,
          results: [],
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const json = JSON.parse(fetched.text);

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
        hasToken: Boolean(token),
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
