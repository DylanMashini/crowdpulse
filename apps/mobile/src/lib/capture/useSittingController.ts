import type { CaptureSource, Reading, SittingKind } from '@triagecam/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import TriageCapture, { type CaptureStatusEvent } from 'triage-capture';

import { api, errorMessage, isApiError } from '@/lib/api';

import { captureErrorCode, captureErrorMessage } from './captureErrors';
import { type LastValid, ReasonTally, type Vital } from './readingFormat';
import { type FaceEnrolment, createUploadQueue, rememberFinishedSitting } from './sittingSession';
import type { SittingUploadQueue } from './uploadQueue';

export const SITTING_MS = 60_000;
const FACE_ENROL_ATTEMPTS = 3;
const LIVE_FPS_WATCHED = 2;
const LIVE_FPS_UNWATCHED = 1;

export type SittingPhase =
  /** Asking for the camera and starting capture. */
  | 'preparing'
  | 'permission_denied'
  /** Capture could not start; `error` says why. */
  | 'unavailable'
  /** Outlines are live and the operator has not started the sitting. */
  | 'framing'
  | 'starting'
  | 'running'
  | 'stopping';

export type LiveViewState = {
  enabled: boolean;
  /** Dashboards watching, from the last frame the server accepted. Null before the first one. */
  viewers: number | null;
  /** Set while frames are not reaching the server. */
  failing: boolean;
};

type Options = {
  ticketNumber: number;
  kind: SittingKind;
  /** The ticket opted in to face match and has no face stored yet. */
  enrolFace: boolean;
  deviceId: string;
  onFinished: (sittingId: string) => void;
};

type RunningSitting = {
  id: string;
  uploads: SittingUploadQueue;
  reasons: ReasonTally;
  face: FaceEnrolment | { status: 'pending'; attempts: number; busy: boolean };
};

/**
 * Runs one sitting on the capture module: permission, framing, the 60 seconds, and the hand-off
 * to the summary. Uploads go through a queue and are never awaited here, so a dropped network
 * cannot hold up the sitting.
 */
export function useSittingController({ ticketNumber, kind, enrolFace, deviceId, onFinished }: Options) {
  const [phase, setPhase] = useState<SittingPhase>('preparing');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CaptureStatusEvent | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [lastValid, setLastValid] = useState<Record<Vital, LastValid | null>>({ heartRate: null, breathingRate: null });
  const [live, setLive] = useState<LiveViewState>({ enabled: false, viewers: null, failing: false });
  const [source] = useState<CaptureSource>(() => TriageCapture.getSource());
  // Wall clock of the last status event: the screen renders once per second from it.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const sitting = useRef<RunningSitting | null>(null);
  const stopping = useRef(false);
  const liveFps = useRef(LIVE_FPS_WATCHED);
  const postingFrame = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const applyCapture = useCallback((result: { phase: SittingPhase; error: string | null }) => {
    setPhase(result.phase);
    setError(result.error);
  }, []);

  const stop = useCallback(async () => {
    const current = sitting.current;
    if (!current || stopping.current) return;
    stopping.current = true;
    setPhase('stopping');
    try {
      const result = await TriageCapture.stopSitting();
      current.uploads.finish({ endedAt: result.endedAt, summary: result.summary });
      void handOffSittingFile(current.id, result.fileUri);
      rememberFinishedSitting({
        sittingId: current.id,
        ticketNumber,
        kind,
        source,
        summary: result.summary,
        mainReasons: { heartRate: current.reasons.main('heartRate'), breathingRate: current.reasons.main('breathingRate') },
        face:
          current.face.status === 'pending'
            ? { status: 'failed', reason: 'No clear view of the face during this sitting' }
            : current.face,
        uploads: current.uploads,
      });
      sitting.current = null;
      onFinishedRef.current(current.id);
    } catch (failure) {
      // The module has no sitting any more, so there is no summary to save.
      current.uploads.dispose();
      sitting.current = null;
      stopping.current = false;
      setReading(null);
      setError(`The sitting could not be finished. ${captureErrorMessage(failure)}`);
      setPhase('framing');
    }
  }, [kind, source, ticketNumber]);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    let sittingId: string;
    try {
      sittingId = (await api.startSitting({ ticketNumber, deviceId, kind, source })).sitting.id;
    } catch (failure) {
      setError(errorMessage(failure));
      return setPhase('framing');
    }
    sitting.current = {
      id: sittingId,
      uploads: createUploadQueue(sittingId),
      reasons: new ReasonTally(),
      face: enrolFace ? { status: 'pending', attempts: 0, busy: false } : { status: 'not_needed' },
    };
    stopping.current = false;
    setReading(null);
    setLastValid({ heartRate: null, breathingRate: null });
    try {
      await TriageCapture.startSitting({ sittingId });
      setPhase('running');
    } catch (failure) {
      sitting.current.uploads.dispose();
      sitting.current = null;
      setError(captureErrorMessage(failure));
      setPhase('framing');
    }
  }, [deviceId, enrolFace, kind, source, ticketNumber]);

  const enrol = useCallback(async () => {
    const current = sitting.current;
    if (!current || current.face.status !== 'pending' || current.face.busy) return;
    const pending = current.face;
    pending.busy = true;
    try {
      const crop = await TriageCapture.captureFaceCrop();
      await api.enrolFace(ticketNumber, crop.jpegBase64);
      current.face = { status: 'enrolled' };
    } catch (failure) {
      const noFace =
        captureErrorCode(failure) === 'ERR_NO_FACE' || (isApiError(failure) && failure.code === 'no_face_detected');
      pending.attempts += 1;
      pending.busy = false;
      if (!noFace) {
        current.face = { status: 'failed', reason: isApiError(failure) ? failure.message : captureErrorMessage(failure) };
      } else if (pending.attempts >= FACE_ENROL_ATTEMPTS) {
        current.face = { status: 'failed', reason: 'No face was found in the picture' };
      }
    }
  }, [ticketNumber]);

  useEffect(() => {
    void beginCapture().then(applyCapture);
    const subscriptions = [
      TriageCapture.addListener('onStatus', (event) => {
        setStatus(event);
        setNowMs(Date.now());
        const current = sitting.current;
        if (!current || event.sittingId !== current.id) return;
        if (event.viewfinder === 'measuring') void enrol();
        if ((event.sittingElapsedMs ?? 0) >= SITTING_MS) void stop();
      }),
      TriageCapture.addListener('onReading', (event) => {
        const current = sitting.current;
        if (!current || event.sittingId !== current.id || stopping.current) return;
        current.uploads.enqueue(event.reading);
        current.reasons.add('heartRate', event.reading.heartRate);
        current.reasons.add('breathingRate', event.reading.breathingRate);
        setReading(event.reading);
        const atMs = Date.now();
        setLastValid((previous) => ({
          heartRate: event.reading.heartRate.value != null ? { value: event.reading.heartRate.value, atMs } : previous.heartRate,
          breathingRate:
            event.reading.breathingRate.value != null
              ? { value: event.reading.breathingRate.value, atMs }
              : previous.breathingRate,
        }));
        if (event.reading.elapsedMs >= SITTING_MS) void stop();
      }),
      TriageCapture.addListener('onPreviewFrame', (frame) => {
        // The live view is a preview: a frame that cannot go out now is dropped, never queued.
        if (postingFrame.current) return;
        postingFrame.current = true;
        api
          .postLiveFrame(deviceId, frame)
          .then(({ viewers }) => {
            setLive((previous) => (previous.enabled ? { enabled: true, viewers, failing: false } : previous));
            const fps = viewers > 0 ? LIVE_FPS_WATCHED : LIVE_FPS_UNWATCHED;
            if (fps !== liveFps.current) {
              liveFps.current = fps;
              void TriageCapture.setLivePreview({ enabled: true, fps }).catch(() => {});
            }
          })
          .catch(() => setLive((previous) => (previous.enabled ? { ...previous, failing: true } : previous)))
          .finally(() => {
            postingFrame.current = false;
          });
      }),
      TriageCapture.addListener('onError', (event) => setError(captureErrorMessage(event))),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      // Leaving the screen ends the live view and the camera. A sitting that was still running
      // is abandoned by the module; the server closes it when the ticket's next sitting starts.
      sitting.current?.uploads.dispose();
      sitting.current = null;
      void TriageCapture.setLivePreview({ enabled: false }).catch(() => {});
      void TriageCapture.stopCapture().catch(() => {});
    };
  }, [applyCapture, deviceId, enrol, stop]);

  const setLiveView = useCallback(async (enabled: boolean) => {
    liveFps.current = LIVE_FPS_WATCHED;
    try {
      await TriageCapture.setLivePreview({ enabled, fps: LIVE_FPS_WATCHED });
      setLive({ enabled, viewers: null, failing: false });
    } catch (failure) {
      setLive({ enabled: false, viewers: null, failing: false });
      setError(`Live view could not be turned ${enabled ? 'on' : 'off'}. ${captureErrorMessage(failure)}`);
    }
  }, []);

  const retry = useCallback(() => {
    setPhase('preparing');
    setError(null);
    void beginCapture().then(applyCapture);
  }, [applyCapture]);

  const elapsedMs = phase === 'running' || phase === 'stopping' ? Math.max(status?.sittingElapsedMs ?? 0, reading?.elapsedMs ?? 0) : 0;

  return {
    phase,
    error,
    source,
    status,
    reading,
    lastValid,
    elapsedSeconds: Math.min(SITTING_MS, elapsedMs) / 1000,
    live,
    nowMs,
    /** Asks for the camera again after a refusal or a failure. */
    retry,
    start,
    stop,
    setLiveView,
  };
}

/** Asks for the camera and starts capture. Resolves with the phase the screen should show. */
async function beginCapture(): Promise<{ phase: SittingPhase; error: string | null }> {
  try {
    let permission = await TriageCapture.getCameraPermission();
    if (permission === 'undetermined') permission = await TriageCapture.requestCameraPermission();
    if (permission !== 'granted') return { phase: 'permission_denied', error: null };
    await TriageCapture.startCapture({ camera: 'back', frameRate: 60 });
    return { phase: 'framing', error: null };
  } catch (failure) {
    return {
      phase: captureErrorCode(failure) === 'ERR_CAMERA_PERMISSION' ? 'permission_denied' : 'unavailable',
      error: captureErrorMessage(failure),
    };
  }
}

/** In development the sitting file goes to the server for the validation work; then it is deleted. */
async function handOffSittingFile(sittingId: string, fileUri: string | null): Promise<void> {
  if (!fileUri) return;
  try {
    if (__DEV__) {
      const file = await (await fetch(fileUri)).blob();
      await api.uploadSittingFile(sittingId, file);
    }
  } catch (failure) {
    console.warn('The sitting file was not uploaded', failure);
  } finally {
    await TriageCapture.deleteSittingFile(fileUri).catch((failure: unknown) =>
      console.warn('The sitting file was not deleted', failure),
    );
  }
}
