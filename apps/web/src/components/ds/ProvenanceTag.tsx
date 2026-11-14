import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import type { Provenance } from './types';

// A solid hairline for anything that is not a live camera reading. The dashed outline belongs to
// "No reading" alone, so a simulated value never looks like a missing one.
const KINDS: Record<Provenance, { word: string; className: string }> = {
  live: { word: 'Live', className: 'bg-signal-soft text-signal' },
  recording: { word: 'Recording', className: 'border border-line-strong text-ink-muted' },
  experimental: { word: 'Experimental', className: 'border border-line-strong text-ink-faint' },
  'ai-draft': { word: 'AI draft', className: 'bg-surface-3 text-ink-muted' },
};

export interface ProvenanceTagProps {
  kind: Provenance;
  children?: ReactNode;
  /** The word alone, for a table column that is nothing but sources. */
  plain?: boolean;
  /** The dot glows: a camera is reading right now. Never set for a finished sitting. */
  reading?: boolean;
  className?: string;
}

/** Where a value came from. Anything that is not a live camera reading carries one. */
export function ProvenanceTag({ kind, children, plain, reading, className }: ProvenanceTagProps) {
  const word = children ?? KINDS[kind].word;
  if (plain) return <span className={cx('type-caption whitespace-nowrap', kind === 'live' ? 'text-ink-faint' : 'text-ink-muted', className)}>{word}</span>;
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-[6px] rounded-sm pr-2 pl-[7px] type-caption font-medium whitespace-nowrap', KINDS[kind].className, className)}>
      {kind === 'live' ? <span aria-hidden className={cx('size-[6px] flex-none rounded-pill bg-current', reading && 'glow-live')} /> : null}
      {word}
    </span>
  );
}
