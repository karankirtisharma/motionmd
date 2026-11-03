'use client';

import { useSyncExternalStore } from 'react';
import type { TourProgressStore } from '@/runtime/tourProgress';

const noSubscription = () => () => {};
function useTourProgress(store: TourProgressStore | undefined, fallback = 0) {
  return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getSnapshot ?? (() => fallback), store?.getServerSnapshot ?? (() => fallback));
}

export function TourTimeline({ store, progress = 0, duration }: { store?: TourProgressStore; progress?: number; duration: number }) {
  const value = Math.max(0, Math.min(1, useTourProgress(store, progress)));
  return <div className="tour-timeline"><span className="timeline-index">{String(Math.floor(value * duration)).padStart(2, '0')}s</span><progress className="cinematic-progress" aria-label="Cinematic progress" max={1} value={value} /><span className="timeline-end">{duration}s</span></div>;
}

export function TourInspectionProgress({ store, duration, showPreview, onSeek }: { store: TourProgressStore; duration: number; showPreview: boolean; onSeek: (progress: number) => void }) {
  const value = useTourProgress(store);
  return <>
    <div>Camera: {(value * 100).toFixed(1)}%</div>
    {showPreview && <label style={{ display: 'block' }}>Tour preview (seconds)
      <input aria-label="Tour preview seconds" type="range" min={0} max={duration} step={0.5} value={value * duration} style={{ width: '100%' }} onChange={event => onSeek(Number(event.target.value) / duration)} />
    </label>}
  </>;
}
