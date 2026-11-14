'use client';

import type { VerifyEmailResponse } from '@triagecam/contracts';
import Link from 'next/link';

import { Button, buttonClass } from '@/components/ds';
import { api } from '@/lib/api';
import { useResource } from '@/lib/use-resource';

import { AuthFrame, FormError, textLink } from './AuthFrame';

// A token works once. React mounts a component twice in development, and a second post would
// turn a good link into "already used", so each token is posted once per page load.
const attempts = new Map<string, Promise<VerifyEmailResponse>>();

function verifyOnce(token: string): Promise<VerifyEmailResponse> {
  let attempt = attempts.get(token);
  if (!attempt) {
    attempt = api.verifyEmail(token);
    attempts.set(token, attempt);
  }
  return attempt;
}

export function VerifyEmail({ token }: { token?: string }) {
  const result = useResource(token ?? null, () => verifyOnce(token ?? ''));

  if (!token) {
    return (
      <AuthFrame title="This link is incomplete" lead="The address is missing its verification code. Open the link from the email again, or ask for a new one.">
        <Link href="/check-email" className={buttonClass('secondary', 'lg', true)}>
          Send a new link
        </Link>
      </AuthFrame>
    );
  }

  if (result.data) {
    return (
      <AuthFrame
        title="Email verified"
        lead={
          <>
            <span className="font-medium text-ink">{result.data.user.email}</span> can now sign in to the dashboard and the phone app.
          </>
        }
      >
        <Link href="/sign-in" className={buttonClass('primary', 'lg', true)}>
          Sign in
        </Link>
      </AuthFrame>
    );
  }

  if (result.error?.code === 'token_invalid') {
    return (
      <AuthFrame
        title="This link no longer works"
        lead="A verification link works once and expires after 24 hours. If the address is already verified, sign in. Otherwise ask for a new link."
      >
        <Link href="/check-email" className={buttonClass('primary', 'lg', true)}>
          Send a new link
        </Link>
        <Link href="/sign-in" className={`${textLink} self-start type-dense`}>
          Sign in
        </Link>
      </AuthFrame>
    );
  }

  if (result.error) {
    return (
      <AuthFrame title="The email could not be verified" lead="The link was not used up. Try it again.">
        <FormError>{result.error.message}</FormError>
        <Button
          block
          size="lg"
          onClick={() => {
            attempts.delete(token);
            result.reload();
          }}
        >
          Try again
        </Button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Verifying your email">
      <p role="status" className="type-dense text-ink-muted">
        Checking the link with the server
      </p>
    </AuthFrame>
  );
}
