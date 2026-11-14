import { useId } from 'react';

import { cx } from '@/lib/cx';

export interface SwitchProps {
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

/** An on or off setting. The track prints its state in words as well as showing it. */
export function Switch({ label, hint, checked = false, disabled, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('flex min-h-control-touch w-full max-w-[480px] items-center justify-between gap-5', disabled && 'opacity-50')}>
      <span className="flex flex-col">
        <span id={`${id}-label`} className="font-semibold">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="type-caption text-ink-muted">
            {hint}
          </span>
        ) : null}
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
          'relative h-[32px] w-[76px] flex-none cursor-pointer rounded-pill border p-0 font-sans disabled:cursor-not-allowed',
          checked ? 'border-signal bg-signal text-on-signal' : 'border-line-strong bg-surface-sunken text-ink',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] left-[3px] size-[24px] rounded-full transition-transform duration-[120ms] ease-out motion-reduce:transition-none',
            checked ? 'translate-x-[44px] bg-on-signal' : 'bg-line-strong',
          )}
        />
        <span className={cx('absolute top-0 text-[13px] leading-[30px] font-medium', checked ? 'left-[12px]' : 'right-[10px]')}>
          {checked ? 'On' : 'Off'}
        </span>
      </button>
    </div>
  );
}
