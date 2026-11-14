import { SESSION_COOKIE } from '@triagecam/contracts';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { LandingPage } from '@/components/landing/LandingPage';

export const metadata: Metadata = {
  title: { absolute: 'Triage Cam: contact-free vital signs for the waiting room' },
  description:
    'A phone camera measures heart rate and breathing without touching the patient, and the waiting-room worklist puts the people whose numbers are changing first.',
};

/**
 * The public landing page. Someone who already has a session cookie gets a link straight to
 * the dashboard instead of the sign-up call to action; the app shell still checks the session.
 */
export default async function Home() {
  const signedIn = (await cookies()).has(SESSION_COOKIE);
  return <LandingPage signedIn={signedIn} />;
}
