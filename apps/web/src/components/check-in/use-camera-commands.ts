import { LIVE_VIEW, type CameraState, type SendCameraCommandRequest } from '@triagecam/contracts';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '@/lib/api';

import { commandSettled, type PendingCommand } from './station';

/** The phone collects a command within a second; this allows for the server's own five and a slow network. */
const NO_ANSWER_AFTER_MS = LIVE_VIEW.commandTimeoutMs + 2000;

export interface CameraCommands {
  /** The command on its way to the phone, until the phone's report shows what came of it. */
  pending: PendingCommand | null;
  /** Why the last command did not go through, in a sentence. */
  error: string | null;
  /** Resolves true when the server took the command for the phone. */
  send: (request: SendCameraCommandRequest) => Promise<boolean>;
  fail: (message: string) => void;
}

/**
 * Sends the check-in page's commands to one camera phone and keeps track of the one in the
 * air. A command is done when the phone's own state says so, not when the server accepts it:
 * until then the button that sent it stays busy, so pressing twice sends once.
 */
export function useCameraCommands(deviceId: string, phone: string, camera: CameraState | null): CameraCommands {
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Settled during render, from the report that settles it.
  if (pending && camera && commandSettled(pending, camera)) setPending(null);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(null);
      setError(`${phone} did not respond. Check that Crowdpulse is open on it, then try again.`);
    }, NO_ANSWER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending, phone]);

  const send = useCallback(
    async (request: SendCameraCommandRequest) => {
      setError(null);
      setPending({ type: request.type, patientNumber: request.patientNumber ?? null });
      try {
        await api.sendCameraCommand(deviceId, request);
        return true;
      } catch (failure) {
        setPending(null);
        setError(failure instanceof ApiError ? failure.message : 'The command could not be sent. Try again.');
        return false;
      }
    },
    [deviceId],
  );

  const fail = useCallback((message: string) => {
    setPending(null);
    setError(message);
  }, []);

  return { pending, error, send, fail };
}
