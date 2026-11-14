import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import type { Provenance } from './types';

const KINDS: Record<Provenance, { word: string; className: string }> = {
  live: { word: 'Live', className: 'border-transparent bg-signal-soft text-ink' },
  recording: { word: 'Recording', className: 'border-dashed border-line-strong text-ink' },
  experimental: { word: 'Experimental', className: 'border-dashed border-line-strong text-ink-muted' },
  'ai-draft': { word: 'AI draft', className: 'border-transparent bg-surface-sunken text-ink' },
  reference: { word: 'Reference', className: 'border-dashed border-line-strong text-ink' },
};

export interface ProvenanceTagProps {
  kind: Provenance;
  children?: ReactNode;
}

/** Where a value came from. Anything that is not a live camera reading carries one. */
export function ProvenanceTag({ kind, children }: ProvenanceTagProps) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-[6px] rounded-sm border px-2 type-label whitespace-nowrap',
        KINDS[kind].className,
      )}
    >
      {kind === 'live' ? <span aria-hidden className="size-2 rounded-full bg-signal" /> : null}
      {children ?? KINDS[kind].word}
    </span>
  );
}
