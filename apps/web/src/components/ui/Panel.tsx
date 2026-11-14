import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export interface PageHeaderProps {
  /** Left out on a page whose heading is in its body, such as a patient's record. */
  title?: ReactNode;
  /** One sentence beside the title: what the screen holds right now. */
  description?: ReactNode;
  /** Sits before the title: the way back, on a page that has one. */
  lead?: ReactNode;
  children?: ReactNode;
}

/**
 * The bar across the top of a screen: its one title, a sentence about what it holds, and its
 * controls at the right. It stays in view while the screen scrolls under it.
 */
export function PageHeader({ title, description, lead, children }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface-1 px-5 py-3">
      {lead}
      {title ? <h1 className="type-subheading text-ink">{title}</h1> : null}
      {description ? <p className="min-w-0 type-dense text-ink-muted">{description}</p> : null}
      {children ? <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div> : null}
    </header>
  );
}

/** The padded region under the header, for a screen that is not ruled edge to edge. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('p-5', className)}>{children}</div>;
}

export interface SectionProps {
  heading?: string;
  /** Sits on the heading's line, at the right. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}

/**
 * A part of a screen, ruled off from the next by a hairline. Screens are built from these, not
 * from outlined cards: brightness and one line do the separating.
 */
export function Section({ heading, aside, children, className, labelledBy }: SectionProps) {
  return (
    <section aria-labelledby={labelledBy} className={cx('border-b border-line p-5', className)}>
      {heading ? (
        <div className="mb-4 flex min-h-control-md flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={labelledBy} className="type-subheading text-ink">
            {heading}
          </h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface PanelProps {
  heading?: string;
  /** Sits on the heading's line, at the right. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A card: one surface step up with a hairline. Never shadowed, and never inside another card. */
export function Panel({ heading, aside, children, className }: PanelProps) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface-2', className)}>
      {heading ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <h2 className="type-label text-ink">{heading}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A message across the top of a screen whose data could not be refreshed. */
export function StaleNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-b border-line bg-watch-soft px-5 py-2 type-dense text-ink">
      {children}
    </p>
  );
}
