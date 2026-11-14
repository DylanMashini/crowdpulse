import type { PatientRef } from '@triagecam/contracts';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * The name and photo of one patient, kept up to date while a screen shows them. During intake
 * the name is typed on the dashboard and the photo is taken mid-sitting, so the phone asks
 * again every few seconds; pass `refreshMs: null` to ask once.
 */
export function usePatientRef(number: number, refreshMs: number | null = 3000): PatientRef {
  const [patient, setPatient] = useState<PatientRef>({ number, name: null, photoUpdatedAt: null });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.patient(number).then(
        ({ patient: found }) => {
          if (cancelled) return;
          setPatient((previous) =>
            previous.name === found.name && previous.photoUpdatedAt === found.photoUpdatedAt
              ? previous
              : { number: found.number, name: found.name, photoUpdatedAt: found.photoUpdatedAt },
          );
        },
        // The identity is a courtesy on these screens: the number still shows if this fails.
        () => {},
      );
    };
    load();
    const timer = refreshMs === null ? null : setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [number, refreshMs]);

  return patient.number === number ? patient : { number, name: null, photoUpdatedAt: null };
}
