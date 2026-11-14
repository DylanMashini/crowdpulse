import { useId, type InputHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  unit?: string;
  hint?: string;
  error?: string;
  size?: 'md' | 'touch';
  /** Fills its container instead of the 240px default. */
  block?: boolean;
}

/** A labelled input with its unit inside the box and its hint or error underneath. */
export function Field({ label, unit, hint, error, size = 'md', block, id, className, ...rest }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const noteId = error || hint ? `${inputId}-note` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', block ? 'w-full' : 'w-[240px] max-w-full', className)}>
      <label className="type-label" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={cx(
          'flex items-center rounded-md bg-surface-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
          size === 'touch' ? 'h-control-touch' : 'h-control-md',
          error ? 'border-2 border-critical' : 'border border-line-strong',
        )}
      >
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          {...rest}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-[15px] text-ink tabular-nums focus-visible:outline-none"
        />
        {unit ? <span className="pr-3 text-[13px] whitespace-nowrap text-ink-muted">{unit}</span> : null}
      </div>
      {error ? (
        <p id={noteId} className="text-[13px] leading-[18px] font-medium text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="type-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
