import { PROTOTYPE_NOTICE } from '@triagecam/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandLockup, textLink } from '@/components/ds';

export interface AuthFrameProps {
  title: string;
  /** One or two sentences under the title. */
  lead?: ReactNode;
  children: ReactNode;
  /** Sign-in only: the one place the dashboard states what the product is. */
  notice?: boolean;
}

/**
 * The frame around every account page: the brand, one title and the form, in a single narrow
 * column set a little above the middle of the window.
 */
export function AuthFrame({ title, lead, children, notice = false }: AuthFrameProps) {
  return (
    <div className="flex min-h-screen flex-col px-5 py-5">
      <Link href="/" className="self-start rounded-md">
        <BrandLockup />
      </Link>
      <main className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center gap-6 pt-8 pb-16">
        <div className="flex flex-col gap-2">
          <h1 className="type-title text-ink">{title}</h1>
          {lead ? <p className="text-ink-muted">{lead}</p> : null}
        </div>
        {children}
      </main>
      {notice ? <p className="mx-auto max-w-[560px] text-center type-caption text-ink-faint">{PROTOTYPE_NOTICE}</p> : null}
    </div>
  );
}

/** A failure of the whole form, as opposed to one field. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-urgent-line bg-urgent-soft px-3 py-2 type-dense text-ink">
      {children}
    </p>
  );
}

/** Why the person is looking at this form, when it is not an error of theirs. */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-line bg-surface-2 px-3 py-2 type-dense text-ink">
      {children}
    </p>
  );
}

export { textLink };
