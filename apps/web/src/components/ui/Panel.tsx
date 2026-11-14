import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export interface PanelProps {
  heading?: string;
  /** Sits on the heading's line, at the right. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** An outlined surface. Panels are never shadowed. */
export function Panel({ heading, aside, children, className }: PanelProps) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface-raised p-4', className)}>
      {heading ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="type-heading">{heading}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

/** The one title of a screen, with its controls on the same line. */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
      <div>
        <h1 className="type-title">{title}</h1>
        {description ? <p className="mt-1 max-w-[640px] text-ink-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div> : null}
    </header>
  );
}
