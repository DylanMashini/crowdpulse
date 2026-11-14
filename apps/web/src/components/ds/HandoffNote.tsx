import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { Icon } from './Icon';
import type { Severity } from './types';

export interface HandoffNoteProps {
  /** The templated sentence from the server, shown as it is. */
  children: ReactNode;
  /** Sits over the sentence: "Trend flag, 03:08". */
  title?: ReactNode;
  /** Urgent takes the red tint. Everything else is a quiet card: the sentence carries it. */
  severity?: Severity | null;
  className?: string;
}

/** The sentence a nurse reads before walking over. A flat fill: red only when the flag is urgent. */
export function HandoffNote({ children, title, severity, className }: HandoffNoteProps) {
  const urgent = severity === 'urgent';
  return (
    <div className={cx('max-w-[560px] rounded-lg border px-4 py-3', urgent ? 'border-urgent-line bg-urgent-soft' : 'border-line bg-surface-2', className)}>
      {title ? (
        <p className={cx('mb-1 flex items-center gap-[6px] type-caption font-medium', urgent ? 'text-urgent' : severity === 'watch' ? 'text-watch' : 'text-ink-muted')}>
          <Icon name="flag" size={14} />
          {title}
        </p>
      ) : null}
      <p className="type-dense text-ink">{children}</p>
    </div>
  );
}
