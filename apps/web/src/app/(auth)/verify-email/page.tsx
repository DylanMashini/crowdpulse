import type { Metadata } from 'next';

import { VerifyEmail } from '@/components/auth/VerifyEmail';

export const metadata: Metadata = { title: 'Verify email' };

export default async function Page({ searchParams }: PageProps<'/verify-email'>) {
  const { token } = await searchParams;
  return <VerifyEmail token={typeof token === 'string' && token ? token : undefined} />;
}
