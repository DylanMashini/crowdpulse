import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TicketScreen } from '@/components/tickets/TicketScreen';

type Props = PageProps<'/tickets/[number]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  return { title: `Ticket ${number}` };
}

export default async function Page({ params }: Props) {
  const { number } = await params;
  if (!/^[1-9]\d{0,8}$/.test(number)) notFound();
  return <TicketScreen number={Number(number)} />;
}
