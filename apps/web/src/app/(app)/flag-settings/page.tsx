import type { Metadata } from 'next';

import { FlagSettingsScreen } from '@/components/settings/FlagSettingsScreen';

export const metadata: Metadata = { title: 'Flag settings' };

export default function Page() {
  return <FlagSettingsScreen />;
}
