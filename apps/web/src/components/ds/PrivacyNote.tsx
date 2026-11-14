import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';

export interface PrivacyNoteProps {
  children: ReactNode;
  icon?: IconName;
  tone?: 'filled' | 'plain';
}

export function PrivacyNote({ children, icon = 'lock', tone = 'filled' }: PrivacyNoteProps) {
  return (
    <p
      className={cx(
        'inline-flex items-center gap-2 text-[13px] leading-[18px]',
        tone === 'plain' ? 'text-ink-muted' : 'rounded-md bg-surface-sunken py-[6px] pr-3 pl-[10px] text-ink',
      )}
    >
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}
