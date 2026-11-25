'use client';

import React from 'react';
import { BarChart2, Coins, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssetCategory } from '@/types/ats';

interface MarketToggleProps {
  value: AssetCategory;
  onChange: (category: AssetCategory) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

const MARKET_OPTIONS: Array<{
  id: AssetCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'stocks', label: 'Stocks', Icon: BarChart2 },
  { id: 'crypto', label: 'Crypto', Icon: Coins },
  { id: 'forex', label: 'FX', Icon: DollarSign },
];

export const MarketToggle: React.FC<MarketToggleProps> = ({
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className,
}) => {
  return (
    <div
      role="group"
      aria-label="Switch Asset Class"
      className={cn(
        'inline-grid grid-cols-3 rounded-xl border border-slate-200 bg-slate-100 p-1',
        fullWidth && 'w-full',
        className
      )}
    >
      {MARKET_OPTIONS.map(({ id, label, Icon }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all',
              size === 'sm'
                ? 'px-2.5 py-1.5 text-xs'
                : 'px-3.5 py-1.5 text-xs sm:text-sm',
              isActive
                ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200 font-bold'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
};
