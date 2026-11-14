import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export interface PrivacyNoteProps {
  children: ReactNode;
  icon?: IconName;
}

/** What happens to the picture, in one quiet line. */
export function PrivacyNote({ children, icon = 'lock' }: PrivacyNoteProps) {
  return (
    <p className="flex items-start gap-2 type-caption text-ink-faint">
      <Icon name={icon} size={14} className="mt-px" />
      <span>{children}</span>
    </p>
  );
}
