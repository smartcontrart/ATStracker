import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats financial prices adaptively (4-5 decimals for Forex/low-priced crypto,
 * 2 decimals for equities & major assets).
 */
export function formatPrice(
  price: number | null | undefined,
  category?: string
): string {
  if (price === null || price === undefined || !Number.isFinite(price)) {
    return '—';
  }
  if (category === 'forex') {
    return price >= 50 ? price.toFixed(3) : price.toFixed(5);
  }
  if (price < 1) return price.toFixed(5);
  if (price < 10) return price.toFixed(4);
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
