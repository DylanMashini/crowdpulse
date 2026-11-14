import type { Metadata } from 'next';

import { AuthFrame } from '@/components/auth/AuthFrame';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function Page({ searchParams }: PageProps<'/sign-in'>) {
  const { next, reason } = await searchParams;
  return (
    <AuthFrame notice title="Sign in" lead="The vitals station and waiting-room worklist for triage staff">
      <SignInForm next={typeof next === 'string' ? next : undefined} reason={typeof reason === 'string' ? reason : undefined} />
    </AuthFrame>
  );
}
