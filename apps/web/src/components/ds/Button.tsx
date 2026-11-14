import type { ButtonHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'lg';

// The primary fill is ice-white, not a colour: red is then never competing with a button.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-signal-strong text-on-signal hover:bg-ink-bright',
  secondary: 'border-line-strong bg-surface-3 text-ink hover:bg-surface-4',
  quiet: 'border-transparent bg-transparent text-ink-muted hover:bg-surface-3 hover:text-ink',
  danger: 'border-urgent-line-strong bg-transparent text-urgent hover:bg-urgent-soft',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-control-md px-3 type-label',
  lg: 'h-control-lg px-4 type-body-strong',
};

/** The button's classes, for a link that has to look like one. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', block = false): string {
  return cx(
    'items-center justify-center gap-2 rounded-md border whitespace-nowrap select-none',
    'cursor-pointer transition-[background-color,border-color,color,transform] active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
    block ? 'flex w-full' : 'inline-flex',
    VARIANTS[variant],
    SIZES[size],
  );
}

/** A link in running text: the accent, with a quiet underline that firms up under the pointer. */
export const textLink = 'rounded-sm text-signal underline decoration-signal-line underline-offset-[3px] transition-colors hover:decoration-signal';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  block?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, block, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} className={cx(buttonClass(variant, size, block), className)}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}
