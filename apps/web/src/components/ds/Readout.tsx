import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import type { Provenance } from './types';

export type ReadoutState = 'valid' | 'settling' | 'none' | 'stale' | 'held';
type ReadoutSize = 'xl' | 'lg' | 'md';

const VALUE: Record<ReadoutSize, string> = {
  xl: 'type-readout-xl',
  lg: 'type-readout-lg',
  md: 'type-readout-md',
};

// Words in place of a number sit on the number's own line height, so the readout does not jump.
const WORDS: Record<ReadoutSize, string> = {
  xl: 'text-[28px] leading-[72px] tracking-[-0.02em]',
  lg: 'text-[20px] leading-[48px] tracking-[-0.01em]',
  md: 'text-[14px] leading-[32px]',
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
  /** Why there is no value. Shown for `none`, for `settling` in place of the default, and under a `held` value. */
  reason?: string;
  /** How old a `held` value is, in its corner: "8 s ago". Left out while the value is fresh. */
  heldAge?: string;
  tag?: Provenance;
  /** Words for the tag when the kind's own word is not exact enough. */
  tagLabel?: ReactNode;
  /** A second tag that qualifies the value itself, beside where it came from: "Lower confidence". */
  qualifier?: ReactNode;
  /** A camera is reading this value now: the numerals take the accent and tick when they change. */
  live?: boolean;
  /** Drawn under the value: the live trace. */
  children?: ReactNode;
}

/**
 * One measured value with its unit, source and age. Without a value it prints "No reading" or
 * "Settling" in words with the reason: never a dash, a zero or the last good number. The one
 * exception is `held`, during a sitting: the latest value stays in its box when the readings
 * after it carry none, in `ink` and not the live accent, with its age in the corner once it is
 * no longer fresh and the reason there is no fresh one underneath.
 */
export function Readout({ label, value, unit, size = 'lg', state = 'valid', icon, age, reason, heldAge, tag, tagLabel, qualifier, live, children }: ReadoutProps) {
  const foot =
    state === 'stale'
      ? `Stale, ${age ?? 'no recent reading'}`
      : state === 'settling'
        ? (reason ?? 'Waiting for three windows to agree')
        : state === 'none'
          ? (reason ?? 'Signal quality too low')
          : state === 'held'
            ? reason
            : age;
  const words = state === 'none' ? 'No reading' : state === 'settling' ? 'Settling' : null;
  const reading = live && state === 'valid';

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-h-[22px] items-center gap-[6px] type-caption text-ink-muted">
        {icon ? <Icon name={icon} /> : null}
        <span>{label}</span>
        {tag ? (
          <ProvenanceTag kind={tag} reading={reading} className="ml-auto">
            {tagLabel}
          </ProvenanceTag>
        ) : null}
      </div>
      <div className={cx('flex items-baseline gap-[6px]', size === 'md' ? 'mt-1' : 'mt-2')}>
        {words ? (
          <span className={cx('font-sans text-ink-muted', WORDS[size])}>{words}</span>
        ) : (
          <>
            {/* Keyed by the value, so a new number is a new element and rises into place. */}
            <span
              key={String(value)}
              className={cx(
                'inline-block',
                VALUE[size],
                reading ? 'animate-tick text-signal-strong' : 'text-ink',
                state === 'stale' && 'text-ink-faint line-through decoration-1',
              )}
            >
              {value}
            </span>
            {unit ? <span className={cx('text-ink-muted', size === 'md' ? 'type-caption' : 'type-dense')}>{unit}</span> : null}
            {/* Beside the number it qualifies, so the header keeps its one line. */}
            {qualifier ? (
              <ProvenanceTag kind="experimental" className="ml-2 self-center">
                {qualifier}
              </ProvenanceTag>
            ) : null}
            {state === 'held' && heldAge ? <span className="ml-auto self-start type-caption tabular-nums text-ink-faint">{heldAge}</span> : null}
          </>
        )}
      </div>
      {children}
      {foot ? <div className={cx('mt-2 type-caption tabular-nums', state === 'stale' ? 'text-watch' : 'text-ink-faint')}>{foot}</div> : null}
    </div>
  );
}
