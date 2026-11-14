import type { Metadata } from 'next';

import { PatientsScreen } from '@/components/patients/PatientsScreen';

export const metadata: Metadata = { title: 'Patients' };

export default function Page() {
  return <PatientsScreen />;
}
