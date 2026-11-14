import type { ReactNode } from 'react';

export interface HandoffNoteProps {
  /** The templated sentence from the server, shown as it is. */
  children: ReactNode;
}

/**
 * The sentence a nurse reads before walking over. The design system also defines an AI draft
 * under a dashed rule; this pass has no drafts, so the note is the measured sentence alone.
 */
export function HandoffNote({ children }: HandoffNoteProps) {
  return (
    <div className="max-w-[560px] overflow-hidden rounded-lg border border-line bg-surface-raised">
      <p className="p-4 font-medium">{children}</p>
    </div>
  );
}
