import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';

import { StationLink } from './stationLink';

/** The camera role's one link to the check-in page. Screens report into it and listen on it. */
export const stationLink = new StationLink((deviceId, report) => api.postLiveState(deviceId, report));

/** How long a sitting screen takes to open and report itself, with room to spare. */
const OPEN_SETTLE_MS = 1200;

/**
 * Keeps the link up while the camera role is open, and opens the sitting screen when the
 * check-in page asks for a patient: from the check-in list, the summary of the last sitting or
 * the face-match screen alike. The sitting screen carries out the other commands itself.
 *
 * Whether a sitting screen is open is read from the link's own state, which that screen sets
 * when it mounts and clears when it goes: the router's path lags behind a screen that is on its
 * way in or out, and a move made on a stale path is dropped or made twice.
 */
export function useStation(deviceId: string | null): void {
  const router = useRouter();

  useEffect(() => {
    if (!deviceId) return;
    stationLink.connect(deviceId);
    return () => stationLink.disconnect();
  }, [deviceId]);

  useEffect(() => {
    let again: ReturnType<typeof setTimeout> | null = null;
    const stop = stationLink.onCommand((command) => {
      if (command.type !== 'open' || command.patientNumber === null || command.kind === null) return;
      const patient = command.patientNumber;
      const sitting = {
        pathname: '/camera/sitting' as const,
        // Face enrolment is decided when the dashboard starts the sitting, not here.
        params: { patient: String(patient), kind: command.kind, enrol: '0' },
      };
      const go = (triesLeft: number) => {
        const open = stationLink.current();
        if (open.phase !== 'idle') {
          // A sitting screen is up. For this patient there is nothing to do; for another (framing
          // only: the server refuses it while a sitting runs) that screen is done with.
          if (open.patientNumber !== patient) router.replace(sitting);
          return;
        }
        // From the check-in list, the summary or the face match alike: on top, and "Next
        // patient" or a call-off goes back to the list from wherever this was opened.
        router.push(sitting);
        // A command can arrive while the last sitting screen is still on its way out (called off
        // and started again within a second). The navigator drops a move made then, so look
        // again once it has settled.
        again = setTimeout(() => {
          again = null;
          if (triesLeft > 0 && stationLink.current().phase === 'idle') go(triesLeft - 1);
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
