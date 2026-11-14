import type { Metadata } from 'next';

import { AuthFrame } from '@/components/auth/AuthFrame';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function Page({ searchParams }: PageProps<'/sign-in'>) {
  const { next } = await searchParams;
  return (
    <AuthFrame title="Sign in" lead="For operators and nurses using the vitals station and the waiting-room worklist">
      <SignInForm next={typeof next === 'string' ? next : undefined} />
    </AuthFrame>
  );
}
