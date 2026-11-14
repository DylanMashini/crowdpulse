import type { Metadata } from 'next';

import { TicketsScreen } from '@/components/tickets/TicketsScreen';

export const metadata: Metadata = { title: 'Tickets' };

export default function Page() {
  return <TicketsScreen />;
}
