import { cx } from '@/lib/cx';

export interface BrandMarkProps {
  size?: 16 | 18 | 20;
  className?: string;
}

/** The pulse trace in the accent: the same line as the favicon and the live trace, with no tile behind it. */
export function BrandMark({ size = 16, className }: BrandMarkProps) {
  return (
    <svg className={cx('block flex-none text-signal', className)} width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M1 9h3.5l2-5 3.5 10 2.2-5H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface BrandLockupProps {
  className?: string;
}

/** The mark beside the product name. The name is always the words "Triage Cam". */
export function BrandLockup({ className }: BrandLockupProps) {
  return (
    <span className={cx('flex min-w-0 items-center gap-2', className)}>
      <BrandMark />
      <span className="truncate type-label text-ink">Triage Cam</span>
    </span>
  );
}
