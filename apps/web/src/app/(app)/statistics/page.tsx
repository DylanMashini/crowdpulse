import type { Metadata } from 'next';

import { StatisticsScreen } from '@/components/statistics/StatisticsScreen';

export const metadata: Metadata = { title: 'Statistics' };

export default function Page() {
  return <StatisticsScreen />;
}
