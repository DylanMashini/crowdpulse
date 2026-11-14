import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import type { Provenance } from './types';

export type ReadoutState = 'valid' | 'settling' | 'none' | 'stale';
type ReadoutSize = 'xl' | 'lg' | 'md';

const VALUE: Record<ReadoutSize, string> = {
  xl: 'text-[72px] leading-[72px] font-semibold',
  lg: 'text-[40px] leading-[44px] font-semibold',
  md: 'text-[22px] leading-[28px] font-medium',
};

const WORDS: Record<ReadoutSize, string> = {
  xl: 'px-4 text-[28px] leading-[70px]',
  lg: 'px-3 text-[20px] leading-[44px]',
  md: 'px-2 text-[15px] leading-[26px]',
};

export interface ReadoutProps {
  label: string;
  value?: number | string;
  unit?: string;
  size?: ReadoutSize;
  state?: ReadoutState;
  icon?: IconName;
  /** How old the value is, in words: "2 s ago". */
  age?: string;
  /** Why there is no value. Shown for `none`, and for `settling` in place of the default. */
  reason?: string;
  tag?: Provenance;
  /** Words for the tag when the kind's own word is not exact enough. */
  tagLabel?: ReactNode;
  /** A second tag that qualifies the value itself, beside where it came from: "Lower confidence". */
  qualifier?: ReactNode;
}

/**
 * One measured value with its unit, source and age. Without a value it prints "No reading" or
 * "Settling" in words with the reason: never a dash, a zero or the last good number.
 */
export function Readout({ label, value, unit, size = 'lg', state = 'valid', icon, age, reason, tag, tagLabel, qualifier }: ReadoutProps) {
  const foot =
    state === 'stale'
      ? `Stale, ${age ?? 'no recent reading'}`
      : state === 'settling'
        ? (reason ?? 'Waiting for three windows to agree')
        : state === 'none'
          ? (reason ?? 'Signal quality too low')
          : age;
  const words = state === 'none' ? 'No reading' : state === 'settling' ? 'Settling' : null;

  return (
    <div className="flex min-w-[150px] flex-col gap-1">
      <div className="flex min-h-[22px] flex-wrap items-center gap-2 type-label text-ink-muted">
        {icon ? <Icon name={icon} size={18} /> : null}
        <span>{label}</span>
        {tag ? <ProvenanceTag kind={tag}>{tagLabel}</ProvenanceTag> : null}
        {qualifier ? <ProvenanceTag kind="experimental">{qualifier}</ProvenanceTag> : null}
      </div>
      <div className="flex items-baseline gap-2 font-mono text-ink tabular-nums">
        {words ? (
          <span className={cx('rounded-md border border-dashed border-line-strong font-sans font-semibold', WORDS[size])}>{words}</span>
        ) : (
          <>
            <span
              className={cx(
                'tracking-[-0.02em]',
                VALUE[size],
                state === 'stale' && 'text-ink-muted line-through decoration-2',
              )}
            >
              {value}
            </span>
            <span className="font-sans text-[15px] text-ink-muted">{unit}</span>
          </>
        )}
      </div>
      {foot ? (
        <div className={cx('text-[13px] leading-[18px]', state === 'stale' ? 'font-medium text-flag' : 'text-ink-muted')}>{foot}</div>
      ) : null}
    </div>
  );
}
