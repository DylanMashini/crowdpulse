import { useId, type InputHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

/**
 * The well every text control sits in: surface-0 with a line-strong border that brightens under
 * the pointer, and an ice border with a soft halo on focus instead of the outline ring.
 */
export const fieldWell =
  'rounded-md border bg-surface-0 transition-[border-color,box-shadow] focus-within:border-signal focus-within:shadow-[0_0_0_3px_var(--signal-soft)]';
export const fieldWellIdle = 'border-line-strong hover:border-line-hover';
export const fieldWellError = 'border-urgent';
export const fieldLabel = 'type-caption text-ink-muted';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  unit?: string;
  hint?: string;
  error?: string;
  size?: 'md' | 'lg';
  /** Fills its container instead of the 240px default. */
  block?: boolean;
}

/** A labelled input with its unit inside the well and its hint or error underneath. */
export function Field({ label, unit, hint, error, size = 'md', block, id, className, ...rest }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const noteId = error || hint ? `${inputId}-note` : undefined;
  return (
    <div className={cx('flex min-w-0 flex-col gap-[6px]', block ? 'w-full' : 'w-[240px] max-w-full', className)}>
      <label className={fieldLabel} htmlFor={inputId}>
        {label}
      </label>
      <div className={cx('flex items-center', fieldWell, error ? fieldWellError : fieldWellIdle, size === 'lg' ? 'h-control-lg' : 'h-control-md')}>
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          {...rest}
          className={cx(
            'h-full min-w-0 flex-1 rounded-md border-0 bg-transparent px-[10px] text-ink tabular-nums placeholder:text-ink-faint focus-visible:outline-none',
            size === 'lg' ? 'type-body' : 'type-dense',
          )}
        />
        {unit ? <span className="pr-[10px] type-caption whitespace-nowrap text-ink-faint">{unit}</span> : null}
      </div>
      {error ? (
        <p id={noteId} className="type-caption text-urgent">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="type-caption text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
