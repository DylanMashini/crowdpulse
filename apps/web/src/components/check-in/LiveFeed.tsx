'use client';

import type { LiveRegions } from '@triagecam/contracts';
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

type Point = { x: number; y: number };

/**
 * Draws the phone's outlines into the overlay, in the picture's own pixels. The overlay's
 * viewBox is the picture's size and it is fitted the way the canvas is, so a point of the frame
 * lands on the same spot of the picture at any size. Done by hand, not through React: this
 * runs for every picture.
 */
function paintRegions(svg: SVGSVGElement, regions: LiveRegions | null, width: number, height: number): void {
  const group = svg.querySelector<SVGGElement>('[data-outlines]');
  if (!group) return;
  if (!regions || !regions.face || width <= 0 || height <= 0) {
    group.setAttribute('display', 'none');
    return;
  }
  const viewBox = `0 0 ${width} ${height}`;
  if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
  // One screen pixel in the picture's pixels, so labels and their gaps keep their size on screen.
  const box = svg.getBoundingClientRect();
  const unit = box.width > 0 && box.height > 0 ? 1 / Math.min(box.width / width, box.height / height) : 1;
  svg.style.setProperty('--u', String(unit));

  const place = (point: Point) => ({ x: point.x * width, y: point.y * height });
  const show = (element: Element, attributes: Record<string, number | string>) => {
    element.removeAttribute('display');
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, typeof value === 'number' ? value.toFixed(1) : value);
  };
  const shape = (name: string, points: Point[] | null) => {
    const element = group.querySelector(`[data-region="${name}"]`);
    if (!element) return;
    if (!points) return element.setAttribute('display', 'none');
    show(element, { points: points.map((point) => `${(point.x * width).toFixed(1)},${(point.y * height).toFixed(1)}`).join(' ') });
  };
  const label = (name: string, at: Point | null) => {
    const element = group.querySelector(`[data-label="${name}"]`);
    if (!element) return;
    if (!at) return element.setAttribute('display', 'none');
    show(element, at);
  };
  // Beside the shape, level with its middle: where the phone's viewfinder puts it.
  const beside = (points: Point[] | null): Point | null => {
    if (!points || points.length === 0) return null;
    const placed = points.map(place);
    return { x: Math.max(...placed.map((point) => point.x)) + 8 * unit, y: placed.reduce((sum, point) => sum + point.y, 0) / placed.length + 4 * unit };
  };

  shape('forehead', regions.forehead);
  shape('leftCheek', regions.leftCheek);
  shape('rightCheek', regions.rightCheek);
  label('forehead', beside(regions.forehead));
  // The label goes beside whichever cheek is further right on the picture.
  const cheeks = [regions.leftCheek, regions.rightCheek].filter((cheek): cheek is Point[] => cheek !== null);
  label('cheeks', beside(cheeks.sort((a, b) => Math.max(...b.map((point) => point.x)) - Math.max(...a.map((point) => point.x)))[0] ?? null));

  const chest = group.querySelector('[data-region="chest"]');
  if (chest && regions.chest) {
    show(chest, {
      x: regions.chest.x * width,
      y: regions.chest.y * height,
      width: regions.chest.width * width,
      height: regions.chest.height * height,
      rx: 6 * unit,
    });
  } else chest?.setAttribute('display', 'none');
  label(
    'chest',
    regions.chest
      ? { x: (regions.chest.x + regions.chest.width / 2) * width, y: Math.min((regions.chest.y + regions.chest.height) * height + 16 * unit, height - 6 * unit) }
      : null,
  );
  group.removeAttribute('display');
}

/** No picture for this long and the feed says so instead of holding a stale face on screen. */
const STALLED_AFTER_MS = 1500;

/**
 * The camera phone's picture, drawn as fast as it arrives, with the outlines of what the phone
 * is measuring on drawn over it. The stream is read part by part and each JPEG is decoded off
 * the main thread; when decoding falls behind, the pictures in between are skipped, so what is
 * on screen is always the newest one. Nothing is kept, and nothing is detected here: the
 * outlines are the phone's own, sent with each picture.
 */
export function LiveFeed({ deviceId, deviceLabel, serverOffsetMs, onStats, children, className }: LiveFeedProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<SVGSVGElement | null>(null);
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
    // What is on screen now, kept so the outlines can be laid out again when the box changes size.
    let shown: { regions: LiveRegions | null; width: number; height: number } | null = null;

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
            // The outlines came with this picture, so they go on screen with it.
            shown = { regions: frame.regions, width: bitmap.width, height: bitmap.height };
            if (overlay.current) paintRegions(overlay.current, shown.regions, shown.width, shown.height);
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

    // The labels are sized in screen pixels, so a resize lays them out again without waiting
    // for the next picture (which may be a while away on a paused feed).
    const resized = new ResizeObserver(() => {
      if (overlay.current && shown) paintRegions(overlay.current, shown.regions, shown.width, shown.height);
    });
    if (overlay.current) resized.observe(overlay.current);

    const tick = setInterval(() => {
      const fresh = lastDrawnAt !== 0 && Date.now() - lastDrawnAt < STALLED_AFTER_MS;
      setStatus(lastDrawnAt === 0 ? 'connecting' : fresh ? 'live' : 'stalled');
      report.current?.(fresh ? { fps: drawn, delayMs: lastDelay } : null);
      drawn = 0;
    }, 1000);

    return () => {
      stopped = true;
      stop();
      resized.disconnect();
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
          aria-label={`Live camera picture from ${deviceLabel}, with the forehead, cheeks and chest it is measuring outlined`}
          className={cx('absolute inset-0 size-full object-contain transition-opacity duration-state', status === 'live' ? 'opacity-100' : 'opacity-40')}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] bg-[size:25%_33.34%]" />
      )}
      {url ? (
        <svg
          ref={overlay}
          aria-hidden
          viewBox="0 0 640 480"
          preserveAspectRatio="xMidYMid meet"
          className={cx('pointer-events-none absolute inset-0 size-full transition-opacity duration-state', status === 'live' ? 'opacity-100' : 'opacity-0')}
        >
          {/* Filled in by paintRegions for each picture. Nothing shows until the phone tracks a face. */}
          <g data-outlines display="none" fill="none" className="stroke-signal" strokeWidth={1.5} strokeLinejoin="round">
            <polygon data-region="forehead" vectorEffect="non-scaling-stroke" />
            <polygon data-region="leftCheek" vectorEffect="non-scaling-stroke" />
            <polygon data-region="rightCheek" vectorEffect="non-scaling-stroke" />
            <rect data-region="chest" vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />
            {/* Each name is drawn over its own dark edge, to read against any picture. */}
            <g
              className="fill-ink stroke-surface-0 font-sans font-medium [paint-order:stroke]"
              style={{ fontSize: 'calc(var(--u, 1) * 12px)', strokeWidth: 'calc(var(--u, 1) * 3px)' }}
            >
              <text data-label="forehead">Forehead</text>
              <text data-label="cheeks">Cheeks</text>
              <text data-label="chest" textAnchor="middle">
                Chest motion
              </text>
            </g>
          </g>
        </svg>
      ) : null}
      {status !== 'live' ? (
        <p role="status" className="absolute inset-x-0 bottom-0 bg-surface-0/80 px-3 py-2 type-caption text-ink-muted">
          {!url ? 'Mock data: there is no camera to show' : status === 'connecting' ? `Connecting to ${deviceLabel}` : `The picture from ${deviceLabel} has paused`}
        </p>
      ) : null}
      {children}
    </div>
  );
}
