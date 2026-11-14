import { cx } from '@/lib/cx';

type TicketSize = 'sm' | 'md' | 'lg' | 'xl';

const NUMBER: Record<TicketSize, string> = {
  sm: 'text-[17px] leading-[22px]',
  md: 'text-[22px] leading-[28px]',
  lg: 'text-[40px] leading-[44px]',
  xl: 'text-[72px] leading-[72px] tracking-[-0.02em]',
};

export interface TicketNumberProps {
  number: number | string;
  size?: TicketSize;
}

/** The one patient identifier on every screen. */
export function TicketNumber({ number, size = 'md' }: TicketNumberProps) {
  return (
    <span className={cx('inline-flex items-baseline whitespace-nowrap', size === 'xl' ? 'flex-col' : 'gap-[6px]')}>
      <span className={cx('font-medium text-ink-muted', size === 'xl' ? 'text-[17px]' : 'text-[13px]')}>Ticket</span>
      <span className={cx('font-mono font-semibold tabular-nums', NUMBER[size])}>{number}</span>
    </span>
  );
}
