import React, { Suspense } from 'react';
import { ATSDashboard } from '@/components/ATSDashboard';

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 font-mono text-sm text-emerald-700">
          Initializing ATS Multi-Timeframe Engine...
        </div>
      }
    >
      <ATSDashboard />
    </Suspense>
  );
}
