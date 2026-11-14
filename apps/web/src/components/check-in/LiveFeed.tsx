'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { liveStreamUrl } from '@/lib/api';
import { cx } from '@/lib/cx';
import { readLiveFeed, type FeedFrame } from '@/lib/live-feed';

export interface FeedStats {
  /** Pictures drawn in the last second. */
  fps: number;
  /** Server receipt to drawn on this screen, in ms, for the newest picture. Null until the clocks are compared. */
  delayMs: number | null;
}

export interface LiveFeedProps {
  deviceId: string;
  deviceLabel: string;
  /** Server clock minus this browser's clock, in ms. Null until it has been measured. */
  serverOffsetMs: number | null;
  onStats?: (stats: FeedStats | null) => void;
  /** Drawn over the picture: the live tag, the frame rate. */
  children?: ReactNode;
  className?: string;
}

/** No picture for this long and the feed says so instead of holding a stale face on screen. */
const STALLED_AFTER_MS = 1500;

/**
 * The camera phone's picture, drawn as fast as it arrives. The stream is read part by part
 * and each JPEG is decoded off the main thread; when decoding falls behind, the pictures in
 * between are skipped, so what is on screen is always the newest one. Nothing is kept.
 */
export function LiveFeed({ deviceId, deviceLabel, serverOffsetMs, onStats, children, className }: LiveFeedProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stalled'>('connecting');
  const offset = useRef(serverOffsetMs);
  const report = useRef(onStats);
  useEffect(() => {
    offset.current = serverOffsetMs;
    report.current = onStats;
  });

  const url = liveStreamUrl(deviceId);

  useEffect(() => {
    if (!url) return;
    let waiting: FeedFrame | null = null;
    let decoding = false;
    let stopped = false;
    let drawn = 0;
    let lastDrawnAt = 0;
    let lastDelay: number | null = null;

    const draw = async () => {
      if (decoding) return;
      decoding = true;
      while (waiting && !stopped) {
        const frame = waiting;
        waiting = null;
        try {
          const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: 'image/jpeg' }));
          const target = canvas.current;
          if (target && !stopped) {
            if (target.width !== bitmap.width || target.height !== bitmap.height) {
              target.width = bitmap.width;
              target.height = bitmap.height;
            }
            target.getContext('2d')?.drawImage(bitmap, 0, 0);
            drawn += 1;
            lastDrawnAt = Date.now();
            if (frame.receivedAt !== null && offset.current !== null) {
              lastDelay = Math.max(0, Math.round(lastDrawnAt + offset.current - frame.receivedAt));
            }
          }
          bitmap.close();
        } catch {
          // A picture that will not decode is skipped; the next one is a fifteenth of a second away.
        }
      }
      decoding = false;
    };

    const stop = readLiveFeed(url, {
      onFrame: (frame) => {
        waiting = frame;
        void draw();
      },
      onConnection: () => {},
    });

    const tick = setInterval(() => {
      const fresh = lastDrawnAt !== 0 && Date.now() - lastDrawnAt < STALLED_AFTER_MS;
      setStatus(lastDrawnAt === 0 ? 'connecting' : fresh ? 'live' : 'stalled');
      report.current?.(fresh ? { fps: drawn, delayMs: lastDelay } : null);
      drawn = 0;
    }, 1000);

    return () => {
      stopped = true;
      stop();
      clearInterval(tick);
      report.current?.(null);
    };
  }, [url]);

  return (
    <div className={cx('relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-line bg-surface-0', className)}>
      {url ? (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Live camera picture from ${deviceLabel}`}
          className={cx('absolute inset-0 size-full object-contain transition-opacity duration-state', status === 'live' ? 'opacity-100' : 'opacity-40')}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] bg-[size:25%_33.34%]" />
      )}
      {status !== 'live' ? (
        <p role="status" className="absolute inset-x-0 bottom-0 bg-surface-0/80 px-3 py-2 type-caption text-ink-muted">
          {!url ? 'Mock data: there is no camera to show' : status === 'connecting' ? `Connecting to ${deviceLabel}` : `The picture from ${deviceLabel} has paused`}
        </p>
      ) : null}
      {children}
    </div>
  );
}
