import { PROTOTYPE_NOTICE } from '@triagecam/contracts';
import type { ReactNode } from 'react';

import { BrandLockup } from '@/components/ds';

export interface AuthFrameProps {
  title: string;
  /** One or two sentences under the title. */
  lead?: ReactNode;
  children: ReactNode;
  /** Sign-in only: the one place the dashboard states what the product is. */
  notice?: boolean;
}

/** The frame around every account page: the brand, one title and the form. */
export function AuthFrame({ title, lead, children, notice = false }: AuthFrameProps) {
  return (
    <div className="flex min-h-screen flex-col px-4 py-6 md:px-6">
      <BrandLockup />
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center gap-5 py-7">
        <div className="flex flex-col gap-2">
          <h1 className="type-title">{title}</h1>
          {lead ? <p className="text-ink-muted">{lead}</p> : null}
        </div>
        {children}
      </main>
      {notice ? <p className="type-caption text-ink-muted">{PROTOTYPE_NOTICE}</p> : null}
    </div>
  );
}

/** A failure of the whole form, as opposed to one field. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-critical bg-critical-soft px-3 py-2 font-medium text-ink">
      {children}
    </p>
  );
}

export const textLink = 'font-medium text-signal underline underline-offset-[3px]';
