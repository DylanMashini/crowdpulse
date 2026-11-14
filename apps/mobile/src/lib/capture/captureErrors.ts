import type { CaptureErrorCode } from 'triage-capture';

const MESSAGES: Partial<Record<CaptureErrorCode, string>> = {
  ERR_CAMERA_PERMISSION: 'Crowdpulse is not allowed to use the camera. Allow it in the Settings app, then come back.',
  ERR_CAMERA_UNAVAILABLE: 'The camera is not available. Close other apps that use it, then try again.',
  ERR_CAPTURE_INTERRUPTED: 'The camera was interrupted. Check that nothing else is using it.',
  ERR_NO_FACE: 'No face is in view',
};

export function captureErrorCode(error: unknown): CaptureErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_') ? (code as CaptureErrorCode) : null;
}

/** A sentence for the operator, from a rejected capture call or an onError event. */
export function captureErrorMessage(error: unknown): string {
  const code = captureErrorCode(error);
  const known = code ? MESSAGES[code] : undefined;
  if (known) return known;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'The camera stopped with an unknown error. Try again.';
}
