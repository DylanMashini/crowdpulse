'use client';

import { patientLabel, type PatientRef } from '@triagecam/contracts';
import { useState } from 'react';

import { patientPhotoUrl } from '@/lib/api';
import { cx } from '@/lib/cx';

import { Icon } from './Icon';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const BOX: Record<AvatarSize, string> = {
  xs: 'size-[24px] text-[10px]',
  sm: 'size-[32px] text-[12px]',
  md: 'size-[40px] text-[13px]',
  lg: 'size-[64px] text-[20px]',
  xl: 'size-[96px] text-[28px]',
};

const ICON: Record<AvatarSize, string> = { xs: 'size-[14px]', sm: 'size-[16px]', md: 'size-[20px]', lg: 'size-[28px]', xl: 'size-[40px]' };

/** "Maya Chen" gives MC, "Okafor" gives O. Null when there is no name to take letters from. */
export function initialsOf(name: string | null): string | null {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const first = words[0];
  if (!first) return null;
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return ((first[0] ?? '') + (last?.[0] ?? '')).toUpperCase();
}

export interface PatientAvatarProps {
  patient: PatientRef;
  size?: AvatarSize;
  className?: string;
}

/**
 * The patient's face, wherever the patient is mentioned. The photo is the one taken at intake;
 * until there is one, the initials stand in, and before there is a name, a plain figure.
 */
export function PatientAvatar({ patient, size = 'md', className }: PatientAvatarProps) {
  const url = patientPhotoUrl(patient);
  // A photo that fails to load (deleted a moment ago, a dropped connection) falls back to initials.
  const [failed, setFailed] = useState<string | null>(null);
  const initials = initialsOf(patient.name);
  const showPhoto = url !== null && failed !== url;

  return (
    <span
      role="img"
      aria-label={showPhoto ? `Photo of ${patientLabel(patient)}` : patientLabel(patient)}
      className={cx(
        'relative inline-flex flex-none items-center justify-center overflow-hidden rounded-pill border border-line-strong bg-surface-4 font-medium text-ink-muted select-none',
        BOX[size],
        className,
      )}
    >
      {showPhoto ? (
        // The photo is a private, authenticated route of this server; next/image cannot fetch it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} onError={() => setFailed(url)} className="absolute inset-0 size-full object-cover" />
      ) : initials ? (
        <span aria-hidden>{initials}</span>
      ) : (
        <Icon name="user" className={ICON[size]} />
      )}
    </span>
  );
}
