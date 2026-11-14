import { patientLabel, type PatientRef } from '@triagecam/contracts';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { PatientAvatar, type AvatarSize } from './PatientAvatar';

type IdentitySize = 'sm' | 'md' | 'lg';

const AVATAR: Record<IdentitySize, AvatarSize> = { sm: 'sm', md: 'md', lg: 'lg' };
const NAME: Record<IdentitySize, string> = {
  sm: 'text-[15px] leading-[20px]',
  md: 'text-[17px] leading-[22px]',
  lg: 'text-[28px] leading-[34px] tracking-[-0.01em]',
};

export interface PatientIdentityProps {
  patient: PatientRef;
  size?: IdentitySize;
  /** The line under the name: age, reason for the visit. The visit number always leads it. */
  detail?: ReactNode;
  /** Use an h1 for the name on the patient's own page. */
  heading?: boolean;
  className?: string;
}

/** A short visit number, for the places a patient is listed by it. */
export function VisitNumber({ number, className }: { number: number; className?: string }) {
  return (
    <span className={cx('whitespace-nowrap text-ink-muted', className)}>
      <span className="sr-only">Visit number </span>
      <span aria-hidden>No. </span>
      <span className="font-mono tabular-nums">{number}</span>
    </span>
  );
}

/** Who a row, a card or a page is about: the face, the name, then the visit number. */
export function PatientIdentity({ patient, size = 'md', detail, heading, className }: PatientIdentityProps) {
  const named = Boolean(patient.name?.trim());
  const Name = heading ? 'h1' : 'span';
  return (
    <span className={cx('inline-flex max-w-full min-w-0 items-center', size === 'lg' ? 'gap-4' : 'gap-3', className)}>
      <PatientAvatar patient={patient} size={AVATAR[size]} />
      <span className="flex min-w-0 flex-col">
        {/* A page heading wraps onto a second line; a name in a row or a tile is cut with an ellipsis. */}
        <Name className={cx(heading ? 'break-words' : 'truncate', 'font-semibold', NAME[size], !named && 'text-ink-muted')}>{patientLabel(patient)}</Name>
        <span className={cx('flex min-w-0 items-center gap-2 text-ink-muted', size === 'lg' ? 'text-[15px] leading-[22px]' : 'text-[13px] leading-[18px]')}>
          {named ? <VisitNumber number={patient.number} /> : <span className="whitespace-nowrap">Name not entered yet</span>}
          {detail ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{detail}</span>
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}

/** "34 y · Twisted ankle" from whatever intake has so far. Null when there is nothing to say. */
export function intakeSummary(ageYears: number | null | undefined, reason: string | null | undefined): string | null {
  const parts = [ageYears == null ? null : `${ageYears} y`, reason?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
