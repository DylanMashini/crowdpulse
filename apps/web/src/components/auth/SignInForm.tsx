'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Field } from '@/components/ds';
import { ApiError, api, errorMessage } from '@/lib/api';
import { sessionEndedText } from '@/lib/session-ended';

import { FormError, FormNotice, textLink } from './AuthFrame';
import { emailProblem, rememberPending } from './validation';

/** Only a path on this site is followed after sign-in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/waiting-room';
}

type Failure = { kind: 'message'; text: string } | { kind: 'unverified'; email: string };

export function SignInForm({ next, reason }: { next?: string; reason?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const emailError = attempted ? emailProblem(email) : null;
  const passwordError = attempted && !password ? 'Enter your password' : null;
  // Set when the dashboard sent staff here because their session ended under them.
  const ended = sessionEndedText(reason);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (emailProblem(email) || !password) return;
    setBusy(true);
    try {
      await api.signIn(email.trim(), password);
      router.replace(safeNext(next));
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        setFailure({ kind: 'message', text: 'Email or password is incorrect. Check both and try again.' });
      } else if (error instanceof ApiError && error.code === 'email_not_verified') {
        setFailure({ kind: 'unverified', email: email.trim() });
      } else {
        setFailure({ kind: 'message', text: errorMessage(error) });
      }
    }
  };

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {ended && !failure ? <FormNotice>{ended}</FormNotice> : null}
      {failure?.kind === 'message' ? <FormError>{failure.text}</FormError> : null}
      {failure?.kind === 'unverified' ? (
        <FormError>
          This email address is not verified yet. Open the link in the email you were sent, or{' '}
          <Link href="/check-email" onClick={() => rememberPending({ email: failure.email })} className={textLink}>
            send a new link
          </Link>
          .
        </FormError>
      ) : null}
      <Field
        block
        size="lg"
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={emailError ?? undefined}
      />
      <Field
        block
        size="lg"
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={passwordError ?? undefined}
      />
      <Button type="submit" variant="primary" size="lg" block disabled={busy}>
        {busy ? 'Signing in' : 'Sign in'}
      </Button>
      <p className="type-dense text-ink-muted">
        No account yet?{' '}
        <Link href="/sign-up" className={textLink}>
          Create a staff account
        </Link>
      </p>
    </form>
  );
}
