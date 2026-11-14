import { cx } from '@/lib/cx';

export interface BrandMarkProps {
  size?: 24 | 28 | 32;
  className?: string;
}

/** The pulse trace on a signal tile: the same mark as the favicon, flat, in one colour. */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <svg
      className={cx('block flex-none', className)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="var(--signal)" />
      <path
        d="M5.5 16.5h5l3-8 5.5 15 3-7h4.5"
        stroke="var(--on-signal)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface BrandLockupProps {
  /** One or two words under the name: what this surface is. */
  descriptor?: string;
  className?: string;
}

/** The mark beside the product name. The name is always the words "Triage Cam". */
export function BrandLockup({ descriptor, className }: BrandLockupProps) {
  return (
    <span className={cx('flex min-w-0 items-center gap-[10px]', className)}>
      <BrandMark />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] leading-[18px] font-semibold text-ink">Triage Cam</span>
        {descriptor ? <span className="truncate text-[12px] leading-[14px] text-ink-muted">{descriptor}</span> : null}
      </span>
    </span>
  );
}
