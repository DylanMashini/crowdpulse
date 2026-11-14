import type { Metadata } from 'next';

import { AuthFrame } from '@/components/auth/AuthFrame';
import { SignUpForm } from '@/components/auth/SignUpForm';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return (
    <AuthFrame title="Create a staff account" lead="One account works on the dashboard and in the phone app. The email address has to be verified before the first sign-in.">
      <SignUpForm />
    </AuthFrame>
  );
}
