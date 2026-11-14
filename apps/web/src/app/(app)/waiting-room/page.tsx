import type { Metadata } from 'next';

import { WaitingRoomScreen } from '@/components/waiting-room/WaitingRoomScreen';

export const metadata: Metadata = { title: 'Waiting room' };

export default function Page() {
  return <WaitingRoomScreen />;
}
