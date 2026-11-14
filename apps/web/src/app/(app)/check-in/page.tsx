import type { Metadata } from 'next';

import { CheckInScreen } from '@/components/check-in/CheckInScreen';

export const metadata: Metadata = { title: 'Check-in' };

export default function Page() {
  return <CheckInScreen />;
}
