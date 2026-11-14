'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Button, Field } from '@/components/ds';
import { api, errorMessage } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { clockTime } from '@/lib/format';

import { AuthFrame, FormError, textLink } from './AuthFrame';
import { emailProblem, rememberPending, usePendingVerification } from './validation';

/** Seconds before the link can be sent again, so a double click does not send two emails. */
const RESEND_WAIT_SECONDS = 30;

export function CheckEmail() {
  const pending = usePendingVerification();
  const now = useNow();
  const [typed, setTyped] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const email = pending?.email ?? typed.trim();
  const waitLeft = sentAt === null ? 0 : Math.max(0, RESEND_WAIT_SECONDS - Math.floor((now - sentAt) / 1000));

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (emailProblem(email)) return;
    setBusy(true);
    try {
      const { devVerificationToken } = await api.resendVerification(email);
      rememberPending({ email, devToken: devVerificationToken });
      setSentAt(Date.now());
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  // Without a mail key the server hands the link back instead of sending it, and the page must not claim an email.
  const handedBack = Boolean(pending?.devToken);
  const sendLabel = busy
    ? 'Sending'
    : waitLeft > 0
      ? `${handedBack ? 'New link' : 'Send again'} in ${waitLeft} s`
      : handedBack
        ? 'Make a new link'
        : pending
          ? 'Send the link again'
          : 'Send the link';

  return (
    <AuthFrame
      title="Check your email"
      lead={
        pending ? (
          <>
            {handedBack ? 'A verification link was made for ' : 'A verification link was sent to '}
            <span className="font-medium text-ink">{pending.email}</span>. It works once and is valid for 24 hours.
          </>
        ) : (
          'Enter the address you signed up with to get a new verification link. It works once and is valid for 24 hours.'
        )
      }
    >
      <form method="post" onSubmit={send} noValidate className="flex flex-col gap-4">
        {failure ? <FormError>{failure}</FormError> : null}
        {pending ? null : (
          <Field
            block
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            error={attempted ? (emailProblem(typed) ?? undefined) : undefined}
          />
        )}
        {sentAt !== null ? (
          <p role="status" className="text-ink">
            {handedBack
              ? `New link made at ${clockTime(sentAt)}. The earlier link no longer needs to be used.`
              : `Sent at ${clockTime(sentAt)}. If nothing arrives in a few minutes, check the spam folder and that the address is right.`}
          </p>
        ) : null}
        <Button type="submit" block disabled={busy || waitLeft > 0}>
          {sendLabel}
        </Button>
      </form>

      {pending?.devToken ? (
        <div className="rounded-lg border border-dashed border-line-strong p-4">
          <p className="type-subheading">No email was sent</p>
          <p className="mt-1 text-ink-muted">
            This server has no mail key, so the verification link is here instead
          </p>
          <Link href={`/verify-email?token=${encodeURIComponent(pending.devToken)}`} className={`${textLink} mt-2 inline-block`}>
            Open the verification link
          </Link>
        </div>
      ) : null}

      <p className="text-ink-muted">
        Already verified?{' '}
        <Link href="/sign-in" className={textLink}>
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
