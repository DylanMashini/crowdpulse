import type { CameraState } from '@triagecam/contracts';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { WebcamCapture } from '@/lib/webcam-capture';
import { WEBCAM_IDLE, WEBCAM_LABEL, WebcamStation } from '@/lib/webcam-station';

/** This browser's webcam device, kept so a reload is the same camera and not one more row in the list. */
const DEVICE_KEY = 'crowdpulse.check-in.webcam';

export interface Webcam {
  /** The camera device this browser's webcam is registered as. Null until it is, and when it cannot be. */
  deviceId: string | null;
  registering: boolean;
  /** What the webcam is doing, as it reports it. */
  state: CameraState;
  station: WebcamStation | null;
}

async function register(): Promise<string> {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(DEVICE_KEY);
  } catch {
    // Private browsing: a new device each visit.
  }
  let id: string;
  try {
    id = (await api.registerCamera(WEBCAM_LABEL, stored ?? undefined)).device.id;
  } catch (failure) {
    // The remembered device belongs to someone else who signed in here, or is gone.
    if (!stored) throw failure;
    id = (await api.registerCamera(WEBCAM_LABEL)).device.id;
  }
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // As above.
  }
  return id;
}

/** One registration at a time, however many times the page asks (React mounts an effect twice in development). */
let registering: Promise<string> | null = null;
function registerOnce(): Promise<string> {
  registering ??= register().finally(() => {
    registering = null;
  });
  return registering;
}

/**
 * This computer's webcam as a camera device of its own. It is registered once per visit to the
 * page, and does nothing more until `useWebcamConnection` puts it to work.
 */
export function useWebcam(): Webcam {
  // The in-browser mock of the API has no camera routes.
  const available = process.env.NEXT_PUBLIC_API_MOCK !== '1';
  const [registration, setRegistration] = useState<{ deviceId: string | null; done: boolean }>({ deviceId: null, done: !available });
  const [state, setState] = useState<CameraState>(WEBCAM_IDLE);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    registerOnce().then(
      (deviceId) => {
        if (!cancelled) setRegistration({ deviceId, done: true });
      },
      () => {
        if (!cancelled) setRegistration({ deviceId: null, done: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [available]);

  const { deviceId } = registration;
  const station = useMemo(
    () => (deviceId ? new WebcamStation(deviceId, { api, openCamera: (handlers) => WebcamCapture.open(handlers) }) : null),
    [deviceId],
  );
  useEffect(() => station?.subscribe(setState), [station]);

  return { deviceId, registering: !registration.done, state, station };
}

/**
 * While `active`, the webcam is this page's camera: it reports to the server like a phone in
 * the camera role and takes the page's commands. When it stops being that, whatever it had
 * open is given up and its light goes out.
 */
export function useWebcamConnection(webcam: Webcam, active: boolean): void {
  const { station } = webcam;
  useEffect(() => {
    if (!station || !active) return;
    station.connect();
    return () => station.disconnect();
  }, [station, active]);
}
