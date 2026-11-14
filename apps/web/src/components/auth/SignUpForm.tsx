'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Field } from '@/components/ds';
import { ApiError, api, errorMessage } from '@/lib/api';

import { FormError, textLink } from './AuthFrame';
import { emailProblem, passwordProblem, rememberPending } from './validation';

export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const emailError = taken === email.trim() ? 'An account with this email already exists. Sign in instead.' : attempted ? emailProblem(email) : null;
  const passwordError = attempted ? passwordProblem(password) : null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (emailProblem(email) || passwordProblem(password)) return;
    setBusy(true);
    try {
      const { user, devVerificationToken } = await api.signUp(email.trim(), password);
      rememberPending({ email: user.email, devToken: devVerificationToken });
      router.push('/check-email');
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'email_taken') setTaken(email.trim());
      else setFailure(errorMessage(error));
    }
  };

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {failure ? <FormError>{failure}</FormError> : null}
      <Field
        block
        label="Work email"
        type="email"
        name="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={emailError ?? undefined}
        hint="A verification link is sent to this address"
      />
      <Field
        block
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={passwordError ?? undefined}
        hint="8 characters or more"
      />
      <Button type="submit" variant="primary" block disabled={busy}>
        {busy ? 'Creating account' : 'Create account'}
      </Button>
      <p className="text-ink-muted">
        Already have an account?{' '}
        <Link href="/sign-in" className={textLink}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
