import { cx } from '@/lib/cx';

export interface SegmentedProps<T extends string> {
  /** Names the choice for screen readers: "View", "Status". */
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export const segmentedWell = 'inline-flex gap-[2px] rounded-md border border-line bg-surface-0 p-[2px]';
/** One segment. The chosen one is a surface step with a hairline along its top edge. */
export function segmentClass(on: boolean): string {
  return cx(
    'h-[26px] cursor-pointer rounded-sm px-[10px] type-dense whitespace-nowrap transition-colors',
    on ? 'bg-surface-3 text-ink shadow-[inset_0_1px_0_var(--line-strong)]' : 'text-ink-muted hover:text-ink',
  );
}

/** A choice between a few views of the same data. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={segmentedWell}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" aria-pressed={on} onClick={() => onChange(option.value)} className={segmentClass(on)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
