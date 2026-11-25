import { ALL_TIMEFRAMES } from '../types/ats.ts';
import type { DailyOHLCV, OHLCVBar, Timeframe } from '../types/ats.ts';

interface BucketDescriptor {
  bucketKey: string;
  periodStart: string;
}

/**
 * Parses a YYYY-MM-DD string into UTC year, month (1-12), and day (1-31)
 * without any local timezone drift.
 */
export function parseUTCDateParts(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const clean = dateStr.slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Computes ISO 8601 week key (YYYY-Www) and Monday start date (YYYY-MM-DD) in pure UTC.
 */
export function getISOWeekDescriptor(
  year: number,
  month: number,
  day: number
): BucketDescriptor {
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoDayOfWeek = date.getUTCDay() || 7; // Monday = 1 ... Sunday = 7

  const monday = new Date(date.getTime());
  monday.setUTCDate(date.getUTCDate() - (isoDayOfWeek - 1));

  // ISO week-year is determined by the Thursday of that week
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(date.getUTCDate() + (4 - isoDayOfWeek));

  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );

  const periodStart = `${monday.getUTCFullYear()}-${pad2(
    monday.getUTCMonth() + 1
  )}-${pad2(monday.getUTCDate())}`;

  return {
    bucketKey: `${isoYear}-W${pad2(weekNumber)}`,
    periodStart,
  };
}

/**
 * Maps any UTC calendar date (YYYY-MM-DD) to its deterministic bucket key and
 * canonical start date for any of the 6 ATS timeframes.
 */
export function getBucketDescriptor(
  dateStr: string,
  timeframe: Timeframe
): BucketDescriptor {
  const clean = dateStr.slice(0, 10);
  if (timeframe === 'D') {
    return { bucketKey: clean, periodStart: clean };
  }

  const { year, month, day } = parseUTCDateParts(clean);

  switch (timeframe) {
    case 'W':
      return getISOWeekDescriptor(year, month, day);

    case 'M':
      return {
        bucketKey: `${year}-${pad2(month)}`,
        periodStart: `${year}-${pad2(month)}-01`,
      };

    case '3M': {
      const quarter = Math.floor((month - 1) / 3) + 1; // 1..4
      const qStartMonth = (quarter - 1) * 3 + 1; // 1, 4, 7, 10
      return {
        bucketKey: `${year}-Q${quarter}`,
        periodStart: `${year}-${pad2(qStartMonth)}-01`,
      };
    }

    case '6M': {
      const half = month <= 6 ? 1 : 2; // H1 or H2
      const hStartMonth = half === 1 ? 1 : 7; // 1 or 7
      return {
        bucketKey: `${year}-H${half}`,
        periodStart: `${year}-${pad2(hStartMonth)}-01`,
      };
    }

    case '12M':
      return {
        bucketKey: `${year}`,
        periodStart: `${year}-01-01`,
      };
  }
}

/**
 * Sanitizes, deduplicates, and chronologically orders raw daily OHLCV bars.
 */
export function sanitizeDailyBars(rawBars: DailyOHLCV[]): DailyOHLCV[] {
  const byDate = new Map<string, DailyOHLCV>();

  for (const bar of rawBars) {
    if (!bar || typeof bar.time !== 'string') continue;
    const cleanDate = bar.time.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) continue;

    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const volume = Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0;

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      continue;
    }

    byDate.set(cleanDate, {
      time: cleanDate,
      open,
      high: Math.max(high, open, close, low),
      low: Math.min(low, open, close, high),
      close,
      volume: Math.max(0, volume),
    });
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.time.localeCompare(b.time)
  );
}

/**
 * Resamples sanitized Daily OHLCV bars into a target ATS timeframe.
 */
export function resampleTimeframe(
  dailyBars: DailyOHLCV[],
  timeframe: Timeframe
): OHLCVBar[] {
  if (dailyBars.length === 0) return [];

  if (timeframe === 'D') {
    return dailyBars.map((b) => ({
      ...b,
      bucketKey: b.time,
      periodStart: b.time,
      periodEnd: b.time,
    }));
  }

  const resampled: OHLCVBar[] = [];
  let currentBar: OHLCVBar | null = null;

  for (const dBar of dailyBars) {
    const { bucketKey, periodStart } = getBucketDescriptor(dBar.time, timeframe);

    if (!currentBar || currentBar.bucketKey !== bucketKey) {
      if (currentBar) {
        resampled.push(currentBar);
      }
      currentBar = {
        time: periodStart,
        open: dBar.open,
        high: dBar.high,
        low: dBar.low,
        close: dBar.close,
        volume: dBar.volume,
        bucketKey,
        periodStart,
        periodEnd: dBar.time,
      };
    } else {
      currentBar.high = Math.max(currentBar.high, dBar.high);
      currentBar.low = Math.min(currentBar.low, dBar.low);
      currentBar.close = dBar.close;
      currentBar.volume += dBar.volume;
      currentBar.periodEnd = dBar.time;
    }
  }

  if (currentBar) {
    resampled.push(currentBar);
  }

  return resampled;
}

/**
 * Resamples Daily (D) OHLCV bars into all 6 strict ATS timeframes:
 * 1. Daily (D) - Raw data
 * 2. Weekly (W) - Grouped by ISO week
 * 3. Monthly (M) - Grouped by calendar month
 * 4. Quarterly (3M) - Grouped by Q1, Q2, Q3, Q4
 * 5. Bi-Annual (6M) - Grouped by H1, H2
 * 6. Annual (12M) - Grouped by calendar year
 */
export function resampleAllTimeframes(
  rawDailyBars: DailyOHLCV[]
): Record<Timeframe, OHLCVBar[]> {
  const sanitized = sanitizeDailyBars(rawDailyBars);

  const result = {} as Record<Timeframe, OHLCVBar[]>;
  for (const tf of ALL_TIMEFRAMES) {
    result[tf] = resampleTimeframe(sanitized, tf);
  }
  return result;
}

/**
 * Finds the corresponding bar in a target timeframe for any hovered calendar date
 * (used for Crosshair Synchronization across D, W, M, 3M, 6M, 12M).
 */
export function findCorrespondingBarForDate(
  dateStr: string,
  targetTimeframe: Timeframe,
  targetBars: OHLCVBar[]
): OHLCVBar | null {
  if (!dateStr || targetBars.length === 0) return null;

  const { bucketKey } = getBucketDescriptor(dateStr, targetTimeframe);

  // Fast binary search by periodStart / time <= dateStr
  let lo = 0;
  let hi = targetBars.length - 1;
  let candidateIdx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const bar = targetBars[mid];
    if (bar.bucketKey === bucketKey) {
      return bar;
    }
    if (bar.periodStart <= dateStr) {
      candidateIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (candidateIdx >= 0) {
    const candidate = targetBars[candidateIdx];
    // When hovering e.g. 2026-01-01 (from 12M/6M/3M) onto Daily, pick the last bar in or near that period,
    // or the exact first trading bar at/after periodStart.
    if (targetTimeframe === 'D' && candidate.time < dateStr && candidateIdx + 1 < targetBars.length) {
      return targetBars[candidateIdx + 1];
    }
    return candidate;
  }

  return targetBars[0];
}
