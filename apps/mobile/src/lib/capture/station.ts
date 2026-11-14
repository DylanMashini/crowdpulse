import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';

import { StationLink } from './stationLink';

/** The camera role's one link to the check-in page. Screens report into it and listen on it. */
export const stationLink = new StationLink((deviceId, report) => api.postLiveState(deviceId, report));

/** How long a screen change takes to finish, with room to spare. */
const OPEN_SETTLE_MS = 800;

/**
 * Keeps the link up while the camera role is open, and opens the sitting screen when the
 * check-in page asks for a patient: from the check-in list, the summary of the last sitting or
 * the face-match screen alike. The sitting screen carries out the other commands itself.
 */
export function useStation(deviceId: string | null): void {
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!deviceId) return;
    stationLink.connect(deviceId);
    return () => stationLink.disconnect();
  }, [deviceId]);

  useEffect(() => {
    let again: ReturnType<typeof setTimeout> | null = null;
    const stop = stationLink.onCommand((command) => {
      if (command.type !== 'open' || command.patientNumber === null || command.kind === null) return;
      const sitting = {
        pathname: '/camera/sitting' as const,
        // Face enrolment is decided when the dashboard starts the sitting, not here.
        params: { patient: String(command.patientNumber), kind: command.kind, enrol: '0' },
      };
      const go = (triesLeft: number) => {
        if (path.current === '/camera') router.push(sitting);
        // On the summary, the face match or another patient's framing: that screen is done with.
        else if (path.current.startsWith('/camera/')) router.replace(sitting);
        else {
          // Somewhere over the camera role, such as settings: back to it first.
          router.dismissTo('/camera');
          router.push(sitting);
        }
        // A command can arrive while the last sitting screen is still on its way out (called off
        // and started again within a second). The navigator drops a move made then, so look
        // again once it has settled.
        again = setTimeout(() => {
          again = null;
          if (path.current !== '/camera/sitting' && triesLeft > 0) go(triesLeft - 1);
        }, OPEN_SETTLE_MS);
      };
      if (again) clearTimeout(again);
      go(2);
    });
    return () => {
      stop();
      if (again) clearTimeout(again);
    };
  }, [router]);
}
