'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export const tableHeadCell = 'bg-surface-sunken px-2 py-2 text-left type-label whitespace-nowrap text-ink-muted first:pl-3 last:pr-3';
export const tableCell = 'border-t border-line px-2 py-3 align-middle first:pl-3 last:pr-3';
const tableFrame = 'w-full overflow-x-auto rounded-lg border border-line bg-surface-raised';

const edgeFade = 'pointer-events-none absolute inset-y-px w-5 from-surface-raised to-transparent';

export interface TableFrameProps {
  /** What the table holds, for the name of the scrolling region: "Waiting-room worklist". */
  label: string;
  children: ReactNode;
}

/**
 * The card around a table. A table wider than the card scrolls sideways inside it; when it does,
 * the cut edge fades, a line under the card says so, and the card takes keyboard focus so the
 * arrow keys scroll it. Nothing is added while every column fits.
 */
export function TableFrame({ label, children }: TableFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ left: false, right: false });

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const left = element.scrollLeft > 1;
      const right = element.scrollLeft < element.scrollWidth - element.clientWidth - 1;
      setHidden((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
    };
    // The observer reports once when it starts, then whenever the card or the table changes width.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, []);

  const scrolls = hidden.left || hidden.right;
  return (
    <div>
      <div className="relative">
        <div
          ref={frame}
          className={tableFrame}
          role={scrolls ? 'region' : undefined}
          aria-label={scrolls ? `${label}, scrolls sideways` : undefined}
          tabIndex={scrolls ? 0 : undefined}
        >
          {children}
        </div>
        {hidden.left ? <span aria-hidden className={`${edgeFade} left-px rounded-l-lg bg-linear-to-r`} /> : null}
        {hidden.right ? <span aria-hidden className={`${edgeFade} right-px rounded-r-lg bg-linear-to-l`} /> : null}
      </div>
      {scrolls ? <p className="mt-1 type-caption text-ink-muted">Scroll sideways for more columns</p> : null}
    </div>
  );
}
