import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';

import { StationLink } from './stationLink';

/** The camera role's one link to the check-in page. Screens report into it and listen on it. */
export const stationLink = new StationLink((deviceId, report) => api.postLiveState(deviceId, report));

/**
 * Keeps the link up while the camera role is open, and opens the sitting screen when the
 * check-in page asks for a patient: from the check-in list, the summary of the last sitting or
 * the face-match screen alike. The sitting screen carries out the other commands itself.
 *
 * Whether a sitting screen is open is read from the link's own state, which that screen sets
 * when it mounts and clears when it goes. A command is carried out once: there is no second
 * try. (An earlier version tried again when the screen did not stay up, which hid BUG-14, the
 * landscape lock turning the interface mid-transition, and opened cancelled check-ins twice.)
 */
export function useStation(deviceId: string | null): void {
  const router = useRouter();

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
        const open = stationLink.current();
        // From the check-in list, the summary or the face match alike: on top, and "Next
        // patient" or a call-off goes back to the list from wherever this was opened.
        if (open.phase === 'idle') return router.push(sitting);
        // A sitting screen is up. For this patient there is nothing to do; for another (framing
        // only: the server refuses it while a sitting runs) that screen is done with.
        if (open.patientNumber !== command.patientNumber) router.replace(sitting);
      }),
    [router],
  );
}
