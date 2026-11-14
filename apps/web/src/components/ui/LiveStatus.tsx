'use client';

import { useLive } from '@/components/app/live';
import { useNow } from '@/lib/clock';
import { clockTime, secondsAgo } from '@/lib/format';

/**
 * How fresh the data on a screen is: its age while the stream is connected, and the time it
 * dates from while the stream is reconnecting.
 */
export function LiveStatus({ updatedAt }: { updatedAt: number | null }) {
  const { status } = useLive();
  const now = useNow();
  if (updatedAt === null || now === 0) return null;

  if (status === 'reconnecting') {
    return (
      <p role="status" className="type-caption font-medium text-flag">
        Reconnecting. Showing data from {clockTime(updatedAt)}.
      </p>
    );
  }
  return (
    <p className="type-caption text-ink-muted tabular-nums">
      {status === 'connecting' ? 'Connecting to live updates. ' : ''}Last updated {secondsAgo(updatedAt, now)}
    </p>
  );
}
