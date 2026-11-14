'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// No outline and no header fill: the table is ruled with hairlines and sits straight on the page,
// running to its edges. The first and last cells carry the page gutter.
export const tableHeadCell = 'border-b border-line px-[10px] py-2 text-left type-caption font-normal whitespace-nowrap text-ink-faint first:pl-5 last:pr-5';
export const tableCell = 'h-row border-b border-line px-[10px] align-middle type-dense text-ink-muted first:pl-5 last:pr-5';
/** A row that can be opened: a surface step under the pointer, in 120ms. */
export const tableRow = 'transition-colors hover:bg-surface-2';
const tableFrame = 'w-full overflow-x-auto';

const edgeFade = 'pointer-events-none absolute inset-y-0 w-6 from-surface-1 to-transparent';

export interface TableFrameProps {
  /** What the table holds, for the name of the scrolling region: "Waiting-room worklist". */
  label: string;
  children: ReactNode;
}

/**
 * The region around a table. A table wider than the page scrolls sideways inside it; when it does,
 * the cut edge fades, a line under it says so, and the region takes keyboard focus so the arrow
 * keys scroll it. Nothing is added while every column fits.
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
        {hidden.left ? <span aria-hidden className={`${edgeFade} left-0 bg-linear-to-r`} /> : null}
        {hidden.right ? <span aria-hidden className={`${edgeFade} right-0 bg-linear-to-l`} /> : null}
      </div>
      {scrolls ? <p className="px-5 pt-2 type-caption text-ink-faint">Scroll sideways for more columns</p> : null}
    </div>
  );
}
