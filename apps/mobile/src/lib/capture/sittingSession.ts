import type { CaptureSource, EstimateReason, SittingKind } from '@triagecam/contracts';
import type { CaptureSittingSummary } from 'triage-capture';

import { api, errorMessage, isApiError } from '@/lib/api';

import type { Vital } from './readingFormat';
import { SittingUploadQueue } from './uploadQueue';

/** How face enrolment went during a sitting, for the line on the summary screen. */
export type FaceEnrolment =
  | { status: 'not_needed' }
  | { status: 'enrolled' }
  | { status: 'failed'; reason: string };

/** Everything the summary screen shows about the sitting that just ended. */
export type FinishedSitting = {
  sittingId: string;
  patientNumber: number;
  kind: SittingKind;
  source: CaptureSource;
  summary: CaptureSittingSummary;
  mainReasons: Record<Vital, EstimateReason | null>;
  /** Which vitals had a value on screen while the sitting ran, recorded or not. */
  shownLive: Record<Vital, boolean>;
  face: FaceEnrolment;
  uploads: SittingUploadQueue;
};

// Queues live here, outside any screen, so an upload keeps retrying after the operator has
// moved on to the next patient.
const finished = new Map<string, FinishedSitting>();

export function createUploadQueue(sittingId: string): SittingUploadQueue {
  return new SittingUploadQueue({
    transport: {
      postReadings: (readings) => api.postReadings(sittingId, readings),
      postFinish: (request) => api.finishSitting(sittingId, request),
    },
    isRetryable: (error) => isApiError(error) && error.retryable,
    describe: errorMessage,
  });
}

export function rememberFinishedSitting(sitting: FinishedSitting): void {
  finished.set(sitting.sittingId, sitting);
  // Keep the last few only: a summary is read right after its sitting.
  for (const id of [...finished.keys()].slice(0, -5)) {
    const old = finished.get(id);
    if (old && old.uploads.getState().finish !== 'pending') {
      old.uploads.dispose();
      finished.delete(id);
    }
  }
}

export function finishedSitting(sittingId: string): FinishedSitting | null {
  return finished.get(sittingId) ?? null;
}
