import { patientLabel, type PatientRef } from '@triagecam/contracts';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { years } from '@/lib/format';

import { PatientAvatar, type AvatarSize } from './PatientAvatar';

type IdentitySize = 'sm' | 'md' | 'lg';

const AVATAR: Record<IdentitySize, AvatarSize> = { sm: 'xs', md: 'md', lg: 'lg' };
const NAME: Record<IdentitySize, string> = {
  sm: 'type-dense',
  md: 'type-subheading',
  lg: 'type-heading',
};

export interface PatientIdentityProps {
  patient: PatientRef;
  /** `sm` is one line, for a 44px table row. `md` and `lg` put the detail under the name. */
  size?: IdentitySize;
  /** After the visit number: age, reason for the visit. */
  detail?: ReactNode;
  /** Use an h1 for the name on the patient's own page. */
  heading?: boolean;
  /** Regular weight for the name: a stable row steps back so a flagged one carries the list. */
  quiet?: boolean;
  /** The name in the brightest ink, for an urgent row. */
  bright?: boolean;
  className?: string;
}

/** A short visit number, for the places a patient is listed by it. */
export function VisitNumber({ number, className }: { number: number; className?: string }) {
  return (
    <span className={cx('whitespace-nowrap', className)}>
      <span className="sr-only">Visit number </span>
      <span aria-hidden>No. </span>
      <span className="tabular-nums">{number}</span>
    </span>
  );
}

/** Who a row, a card or a page is about: the face, the name, then the visit number. */
export function PatientIdentity({ patient, size = 'md', detail, heading, quiet, bright, className }: PatientIdentityProps) {
  const named = Boolean(patient.name?.trim());
  const Name = heading ? 'h1' : 'span';
  const name = (
    <Name
      className={cx(
        NAME[size],
        // A page heading wraps onto a second line; a name in a row or a tile is cut with an ellipsis.
        heading ? 'break-words' : 'truncate',
        size === 'sm' && (quiet ? 'font-normal' : 'font-medium'),
        named ? (bright ? 'text-ink-bright' : 'text-ink') : 'text-ink-muted',
      )}
    >
      {patientLabel(patient)}
    </Name>
  );
  const meta = (
    <>
      {named ? <VisitNumber number={patient.number} /> : <span className="whitespace-nowrap">Name not entered yet</span>}
      {detail ? <span className="truncate">, {detail}</span> : null}
    </>
  );

  if (size === 'sm') {
    return (
      <span className={cx('flex max-w-full min-w-0 items-center gap-[10px]', className)}>
        <PatientAvatar patient={patient} size="xs" />
        <span className="flex min-w-0 items-baseline gap-[10px]">
          {name}
          <span className="flex min-w-0 shrink-[9999] type-dense text-ink-faint">{meta}</span>
        </span>
      </span>
    );
  }

  return (
    <span className={cx('inline-flex max-w-full min-w-0 items-center', size === 'lg' ? 'gap-4' : 'gap-3', className)}>
      <PatientAvatar patient={patient} size={AVATAR[size]} />
      <span className="flex min-w-0 flex-col">
        {name}
        <span className={cx('flex min-w-0 text-ink-muted', size === 'lg' ? 'type-dense' : 'type-caption')}>{meta}</span>
      </span>
    </span>
  );
}

/** "34 y, twisted ankle" from whatever intake has so far. Null when there is nothing to say. */
export function intakeSummary(ageYears: number | null | undefined, reason: string | null | undefined): string | null {
  const parts = [ageYears == null ? null : years(ageYears), reason?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
