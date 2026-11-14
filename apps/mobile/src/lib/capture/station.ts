import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';

import { StationLink } from './stationLink';

/** The camera role's one link to the check-in page. Screens report into it and listen on it. */
export const stationLink = new StationLink((deviceId, report) => api.postLiveState(deviceId, report));

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

  useEffect(
    () =>
      stationLink.onCommand((command) => {
        if (command.type !== 'open' || command.patientNumber === null || command.kind === null) return;
        const sitting = {
          pathname: '/camera/sitting' as const,
          // Face enrolment is decided when the dashboard starts the sitting, not here.
          params: { patient: String(command.patientNumber), kind: command.kind, enrol: '0' },
        };
        if (path.current === '/camera') return router.push(sitting);
        // On the summary, the face match or another patient's framing: that screen is done with.
        if (path.current.startsWith('/camera/')) return router.replace(sitting);
        // Somewhere over the camera role, such as settings: back to it first.
        router.dismissTo('/camera');
        router.push(sitting);
      }),
    [router],
  );
}
