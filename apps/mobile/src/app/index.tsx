import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session/SessionProvider';

/** The anchor route: sends the phone to the screen its session and role call for. */
export default function Home() {
  const { state } = useSession();
  if (state.status !== 'signedIn') return <Redirect href="/sign-in" />;
  if (!state.device) return <Redirect href="/role" />;
  return <Redirect href={state.device.role === 'camera' ? '/camera' : '/nurse'} />;
}
