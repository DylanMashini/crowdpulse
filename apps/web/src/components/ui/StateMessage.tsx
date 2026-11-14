import type { ReactNode } from 'react';

import { Button } from '@/components/ds';
import { cx } from '@/lib/cx';

export interface StateMessageProps {
  kind: 'loading' | 'empty' | 'error';
  /** What happened. */
  title: string;
  /** What to do next. */
  children?: ReactNode;
  /** For an error: runs the request again. */
  onRetry?: () => void;
  action?: ReactNode;
  /** Without the page gutter, for a message inside a section that has its own. */
  flush?: boolean;
  className?: string;
}

/**
 * The loading, empty and error state of a screen or a section, in words, set where the content
 * would start. Nothing spins and nothing is boxed: the title says what happened and the line
 * under it says what to do.
 */
export function StateMessage({ kind, title, children, onRetry, action, flush, className }: StateMessageProps) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex max-w-[560px] flex-col items-start', !flush && 'p-5', className)}>
      <p className={kind === 'loading' ? 'type-dense text-ink-muted' : 'type-subheading text-ink'}>{title}</p>
      {children ? <div className="mt-1 type-dense text-ink-muted">{children}</div> : null}
      {onRetry || action ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
