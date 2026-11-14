'use client';

import { useEffect, useRef } from 'react';

import { cx } from '@/lib/cx';

export interface LiveTraceProps {
  kind: 'pulse' | 'breath';
  /**
   * Beats or breaths a minute to draw at. Null stops the trace and clears it: nothing is drawn
   * unless a camera is giving a reading.
   */
  rate: number | null;
  /** How many seconds the width of the trace covers. */
  seconds?: number;
  className?: string;
}

/** One beat of a pulse wave, 0 to 1 across the beat: the systolic peak, then a smaller reflected wave. */
function pulseShape(phase: number): number {
  return Math.exp(-(((phase - 0.2) / 0.075) ** 2)) + 0.38 * Math.exp(-(((phase - 0.5) / 0.12) ** 2));
}

function breathShape(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

/**
 * The live trace: the one thing in the product that moves on its own. It is a drawing of the
 * measured rate, a wave that passes at that many beats or breaths a minute, not the camera's raw
 * signal. It runs only while it is given a rate, stops while the tab is hidden, and is a still
 * line for anyone who has asked for reduced motion.
 */
export function LiveTrace({ kind, rate, seconds, className }: LiveTraceProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // The wave's phase is carried across rate changes, so a new reading bends the line instead of jumping it.
  const phase = useRef(0);
  const latest = useRef(rate);
  useEffect(() => {
    latest.current = rate;
  });
  const running = rate !== null;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    if (!running) {
      context.clearRect(0, 0, element.width, element.height);
      return;
    }

    const style = getComputedStyle(element);
    const line = style.getPropertyValue('--series-estimate').trim() || '#a9dcf7';
    const head = style.getPropertyValue('--ink-bright').trim() || '#ffffff';
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last: number | null = null;
    // A still line is drawn mid-beat, so the peak is in view.
    if (still && phase.current === 0) phase.current = 0.35;

    const draw = (now: number) => {
      const box = element.getBoundingClientRect();
      if (box.width !== width || box.height !== height) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = box.width;
        height = box.height;
        element.width = Math.max(1, Math.round(width * ratio));
        element.height = Math.max(1, Math.round(height * ratio));
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      const perMinute = latest.current ?? 0;
      if (last !== null && !still) phase.current += ((now - last) / 60_000) * perMinute;
      last = now;
      if (!width || !height || perMinute <= 0) return;

      context.clearRect(0, 0, width, height);
      const span = seconds ?? (kind === 'pulse' ? Math.max(3, width / 90) : Math.max(10, width / 26));
      const cycles = (span / 60) * perMinute;
      const pad = 6;
      const amplitude = height - pad * 2;
      const headX = width - 10;
      let headY = 0;
      context.beginPath();
      for (let x = 0; x <= headX; x += 1) {
        const at = phase.current - ((headX - x) / headX) * cycles;
        const within = ((at % 1) + 1) % 1;
        // A slow drift in height, so no two beats are drawn identical.
        const value = (kind === 'pulse' ? pulseShape(within) : breathShape(within)) * (0.9 + 0.1 * Math.sin(at * 0.83));
        const y = pad + amplitude * (1 - value * 0.92);
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
        headY = y;
      }
      // The line fades out behind itself: one colour to transparent, never one hue to another.
      const fade = context.createLinearGradient(0, 0, headX, 0);
      fade.addColorStop(0, 'transparent');
      fade.addColorStop(1, line);
      context.strokeStyle = fade;
      context.lineWidth = 1.5;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
      // The head is one of the two places a glow is allowed.
      context.save();
      context.shadowColor = line;
      context.shadowBlur = 10;
      context.fillStyle = head;
      context.beginPath();
      context.arc(headX, headY, 2.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };

    const tick = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      last = null;
      if (still) draw(performance.now());
      else if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    start();
    document.addEventListener('visibilitychange', start);
    window.addEventListener('resize', start);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', start);
      window.removeEventListener('resize', start);
    };
  }, [kind, running, seconds]);

  return <canvas ref={canvas} aria-hidden className={cx('block h-[40px] w-full', className)} />;
}
