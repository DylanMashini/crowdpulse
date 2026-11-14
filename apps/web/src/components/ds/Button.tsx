import type { ButtonHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'touch';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-signal bg-signal text-on-signal hover:brightness-[0.92]',
  secondary: 'border-line-strong bg-surface-raised text-ink hover:bg-surface-sunken',
  quiet: 'border-transparent bg-transparent text-signal hover:bg-surface-sunken',
  danger: 'border-critical bg-surface-raised text-critical hover:bg-critical-soft',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-control-md px-4 text-[15px]',
  touch: 'h-control-touch px-5 text-[17px]',
};

/** The button's classes, for a link that has to look like one. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', block = false): string {
  return cx(
    'items-center justify-center gap-2 whitespace-nowrap rounded-md border font-sans leading-[22px] font-semibold',
    'cursor-pointer transition-colors duration-[120ms] ease-out active:translate-y-px',
    'disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45',
    block ? 'flex w-full' : 'inline-flex',
    VARIANTS[variant],
    SIZES[size],
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  block?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, block, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} className={cx(buttonClass(variant, size, block), className)}>
      {icon ? <Icon name={icon} size={size === 'touch' ? 20 : 18} /> : null}
      <span>{children}</span>
    </button>
  );
}
