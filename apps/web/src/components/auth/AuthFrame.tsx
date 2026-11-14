import { PROTOTYPE_NOTICE } from '@triagecam/contracts';
import type { ReactNode } from 'react';

export interface AuthFrameProps {
  title: string;
  /** One or two sentences under the title. */
  lead?: ReactNode;
  children: ReactNode;
}

/** The frame around every account page: the product name, one title, the form, the notice. */
export function AuthFrame({ title, lead, children }: AuthFrameProps) {
  return (
    <div className="flex min-h-screen flex-col px-4 py-6 md:px-6">
      <p className="text-[16px] leading-[22px] font-semibold">Triage Cam</p>
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center gap-5 py-7">
        <div className="flex flex-col gap-2">
          <h1 className="type-title">{title}</h1>
          {lead ? <p className="text-ink-muted">{lead}</p> : null}
        </div>
        {children}
      </main>
      <p className="type-caption text-ink-muted">{PROTOTYPE_NOTICE}. Accounts are for staff. Patients are ticket numbers only.</p>
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
