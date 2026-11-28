import type { Timeframe } from '@/types/ats';

export type CrosshairSyncListener = (payload: {
  sourceTimeframe: Timeframe;
  hoveredDate: string | null;
  hoveredPrice: number | null;
}) => void;

/**
 * Lightweight pub/sub bus for 60fps TradingView-style 2D (time + price)
 * crosshair synchronization across all 6 ATS timeframe panes.
 */
export class CrosshairSyncBus {
  private listeners = new Map<Timeframe, CrosshairSyncListener>();

  register(timeframe: Timeframe, listener: CrosshairSyncListener): () => void {
    this.listeners.set(timeframe, listener);
    return () => {
      this.listeners.delete(timeframe);
    };
  }

  emit(
    sourceTimeframe: Timeframe,
    hoveredDate: string | null,
    hoveredPrice: number | null = null
  ): void {
    for (const [tf, listener] of this.listeners.entries()) {
      if (tf !== sourceTimeframe) {
        listener({ sourceTimeframe, hoveredDate, hoveredPrice });
      }
    }
  }
}
