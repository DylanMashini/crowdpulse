import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PatientScreen } from '@/components/patients/PatientScreen';

type Props = PageProps<'/patients/[number]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  return { title: `Patient ${number}` };
}

export default async function Page({ params }: Props) {
  const { number } = await params;
  if (!/^[1-9]\d{0,8}$/.test(number)) notFound();
  return <PatientScreen number={Number(number)} />;
}
