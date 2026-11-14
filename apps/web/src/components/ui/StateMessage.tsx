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
  className?: string;
}

/** The loading, empty and error state of a screen or a panel, in words. Nothing spins. */
export function StateMessage({ kind, title, children, onRetry, action, className }: StateMessageProps) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex flex-col items-start gap-2 rounded-lg p-4',
        kind === 'loading' ? 'text-ink-muted' : 'max-w-[720px] border border-dashed border-line-strong',
        className,
      )}
    >
      <p className={kind === 'loading' ? undefined : 'type-subheading'}>{title}</p>
      {children ? <div className="max-w-[560px] text-ink-muted">{children}</div> : null}
      {onRetry || action ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
