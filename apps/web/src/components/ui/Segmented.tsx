import { cx } from '@/lib/cx';

export interface SegmentedProps<T extends string> {
  /** Names the choice for screen readers: "View", "Status". */
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** A choice between a few views of the same data. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-control-md items-stretch rounded-md border border-line-strong bg-surface-raised p-[2px]">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cx(
              'cursor-pointer rounded-sm px-3 text-[15px] whitespace-nowrap transition-colors duration-[120ms] ease-out',
              on ? 'bg-surface-sunken font-semibold text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
