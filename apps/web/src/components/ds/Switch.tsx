import { useId } from 'react';

import { cx } from '@/lib/cx';

export interface SwitchProps {
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

/** An on or off setting. The state is printed in words beside the track as well as shown by it. */
export function Switch({ label, hint, checked = false, disabled, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('flex w-full items-center justify-between gap-6', disabled && 'opacity-40')}>
      <span className="flex min-w-0 flex-col">
        <span id={`${id}-label`} className="type-label text-ink">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="type-dense text-ink-muted">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="flex flex-none items-center gap-2">
        <span aria-hidden className={cx('w-[20px] text-right type-caption tabular-nums', checked ? 'text-ink' : 'text-ink-faint')}>
          {checked ? 'On' : 'Off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled}
          onClick={() => onChange?.(!checked)}
          className={cx(
            'relative h-[20px] w-[36px] flex-none cursor-pointer rounded-pill border p-0 transition-[background-color,border-color] duration-state disabled:cursor-not-allowed',
            checked ? 'border-transparent bg-signal-strong' : 'border-line-strong bg-surface-4 hover:border-line-hover',
          )}
        >
          <span
            className={cx(
              'absolute top-[2px] left-[2px] size-[14px] rounded-pill transition-transform duration-state',
              checked ? 'translate-x-[16px] bg-on-signal' : 'bg-ink-muted',
            )}
          />
        </button>
      </span>
    </div>
  );
}
