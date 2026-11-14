import type { Estimate, EstimateReason } from '@triagecam/contracts';

import type {
  CaptureSittingSummary,
  CaptureStatusEvent,
  FaceRegionsEvent,
  LivePreviewOptions,
  Point,
  SittingResult,
  Subscription,
  TriageCapture,
  TriageCaptureEvents,
} from './types';

// Stands in for the Swift module when it is not in the build, so screens can be developed
// first. It plays a fixed script: a face appears after 2 s, heart rate is valid from 11 s and
// breathing rate from 30 s. Nothing here measures anything; getSource() says 'stub' so the
// screens can label it.

const HEART_RATE_VALID_AT = 11;
const BREATHING_VALID_AT = 30;
const FACE_AT = 2;

/** A 64 by 36 flat dark JPEG: the stub has no camera and never fabricates a picture. */
const PLACEHOLDER_JPEG =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAECgAwAEAAAAAQAAACQAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIACQAQAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAkJCQkJCRAJCRAWEBAQFh4WFhYWHiYeHh4eHiYuJiYmJiYmLi4uLi4uLi43Nzc3NzdAQEBAQEhISEhISEhISEj/2wBDAQsMDBIREh8RER9LMyozS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0v/3QAEAAT/2gAMAwEAAhEDEQA/APJ6KKKCAooooAKKKKACiiigD//Q8nooooICiiigAooooAKKKKAP/9HyeiiiggKKKKACiiigAooooA//2Q==';

type Listeners = { [Name in keyof TriageCaptureEvents]: Set<TriageCaptureEvents[Name]> };

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function rectangle(x: number, y: number, width: number, height: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

class Vital {
  private validSeconds = 0;
  private lastValidAt: number | null = null;
  readonly values: number[] = [];

  constructor(
    private readonly validAt: number,
    private readonly value: (second: number) => number,
  ) {}

  at(second: number): Estimate {
    const valid = second >= this.validAt;
    if (valid) {
      this.validSeconds += 1;
      this.lastValidAt = second;
      this.values.push(this.value(second));
    }
    let reason: EstimateReason | null = null;
    if (!valid) reason = second < FACE_AT ? 'no_face' : second < this.validAt - 3 ? 'warming_up' : 'awaiting_agreement';
    return {
      value: valid ? this.values[this.values.length - 1]! : null,
      state: valid ? 'valid' : 'settling',
      reason,
      quality: valid ? 0.82 : 0,
      coverage: second > 0 ? this.validSeconds / second : 0,
      ageMs: this.lastValidAt === null ? null : (second - this.lastValidAt) * 1000,
    };
  }

  get validCount(): number {
    return this.validSeconds;
  }
}

type RunningSitting = { id: string; startedMs: number; second: number; heartRate: Vital; breathingRate: Vital };

export class TriageCaptureStub implements TriageCapture {
  private readonly listeners: Listeners = {
    onReading: new Set(),
    onStatus: new Set(),
    onFaceRegions: new Set(),
    onPreviewFrame: new Set(),
    onLiveUpload: new Set(),
    onError: new Set(),
  };
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private regionTimer: ReturnType<typeof setInterval> | null = null;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private captureStartedMs = 0;
  private sitting: RunningSitting | null = null;

  getSource() {
    return 'stub' as const;
  }

  async getCameraPermission() {
    return 'granted' as const;
  }

  async requestCameraPermission() {
    return 'granted' as const;
  }

  async startCapture() {
    if (this.secondTimer) return;
    this.captureStartedMs = Date.now();
    this.secondTimer = setInterval(() => this.everySecond(), 1000);
    this.regionTimer = setInterval(() => this.emit('onFaceRegions', this.regions()), 100);
  }

  async stopCapture() {
    for (const timer of [this.secondTimer, this.regionTimer, this.previewTimer]) {
      if (timer) clearInterval(timer);
    }
    this.secondTimer = this.regionTimer = this.previewTimer = null;
    this.sitting = null;
  }

  async startSitting({ sittingId }: { sittingId: string }) {
    if (!this.secondTimer) throw codedError('ERR_NOT_CAPTURING', 'Start capture before a sitting');
    if (this.sitting) throw codedError('ERR_SITTING_RUNNING', 'A sitting is already running');
    const startedMs = Date.now();
    this.sitting = {
      id: sittingId,
      startedMs,
      second: 0,
      heartRate: new Vital(HEART_RATE_VALID_AT, (second) => 72 + Math.round(2 * Math.sin(second / 7))),
      breathingRate: new Vital(BREATHING_VALID_AT, (second) => 16 + Math.round(Math.sin(second / 11))),
    };
    return { sittingId, startedAt: new Date(startedMs).toISOString() };
  }

  async stopSitting(): Promise<SittingResult> {
    const sitting = this.sitting;
    if (!sitting) throw codedError('ERR_NO_SITTING', 'No sitting is running');
    this.sitting = null;
    const seconds = Math.max(sitting.second, 1);
    const heartRate = median(sitting.heartRate.values);
    const breathingRate = median(sitting.breathingRate.values);
    // The script has no beats to time.
    const none = { value: null, coverage: 0, reason: heartRate === null ? 'no_heart_rate' : 'too_few_beats' } as const;
    const summary: CaptureSittingSummary = {
      durationSeconds: (Date.now() - sitting.startedMs) / 1000,
      frameCount: sitting.second * 60,
      droppedFrames: 0,
      heartRate: {
        value: heartRate,
        coverage: sitting.heartRate.validCount / seconds,
        reason: heartRate === null ? 'too_few_readings' : null,
      },
      breathingRate: {
        value: breathingRate,
        coverage: sitting.breathingRate.validCount / seconds,
        reason: breathingRate === null ? 'too_few_readings' : null,
      },
      rmssd: none,
      sdnn: none,
      beatIntervals: [],
      timeToFirstReadingSeconds: sitting.second >= HEART_RATE_VALID_AT ? HEART_RATE_VALID_AT : null,
      longestDropoutSeconds: 0,
    };
    return { sittingId: sitting.id, endedAt: new Date().toISOString(), summary, fileUri: null };
  }

  async deleteSittingFile() {}

  setLandscapeLock() {}

  async setLivePreview({ enabled, fps = 2 }: LivePreviewOptions) {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    if (!enabled) return;
    const interval = 1000 / Math.min(Math.max(fps, 1), 5);
    this.previewTimer = setInterval(() => {
      this.emit('onPreviewFrame', { jpegBase64: PLACEHOLDER_JPEG, width: 64, height: 36, t: new Date().toISOString() });
    }, interval);
  }

  async captureFaceCrop() {
    return { jpegBase64: PLACEHOLDER_JPEG, width: 64, height: 36 };
  }

  addListener<Name extends keyof TriageCaptureEvents>(name: Name, listener: TriageCaptureEvents[Name]): Subscription {
    this.listeners[name].add(listener);
    return { remove: () => this.listeners[name].delete(listener) };
  }

  private emit<Name extends keyof TriageCaptureEvents>(name: Name, event: Parameters<TriageCaptureEvents[Name]>[0]) {
    for (const listener of this.listeners[name]) (listener as (payload: typeof event) => void)(event);
  }

  private faceVisible(): boolean {
    return Date.now() - this.captureStartedMs >= FACE_AT * 1000;
  }

  private everySecond() {
    const sitting = this.sitting;
    const facePresent = this.faceVisible();
    const status: CaptureStatusEvent = {
      source: 'stub',
      fps: 60,
      droppedFrames: 0,
      exposureLocked: facePresent,
      thermalState: 'nominal',
      facePresent,
      viewfinder: facePresent ? 'measuring' : 'searching',
      sittingId: sitting?.id ?? null,
      sittingElapsedMs: sitting ? Date.now() - sitting.startedMs : null,
    };
    this.emit('onStatus', status);
    if (!sitting) return;
    sitting.second += 1;
    this.emit('onReading', {
      sittingId: sitting.id,
      reading: {
        t: new Date().toISOString(),
        elapsedMs: sitting.second * 1000,
        heartRate: sitting.heartRate.at(sitting.second),
        breathingRate: sitting.breathingRate.at(sitting.second),
      },
    });
  }

  private regions(): FaceRegionsEvent {
    if (!this.faceVisible()) {
      return { aspectRatio: 16 / 9, face: null, forehead: null, leftCheek: null, rightCheek: null, chest: null };
    }
    const sway = 0.004 * Math.sin(Date.now() / 900);
    const x = 0.5 + sway;
    return {
      aspectRatio: 16 / 9,
      face: { x: x - 0.09, y: 0.14, width: 0.18, height: 0.4 },
      forehead: rectangle(x - 0.05, 0.17, 0.1, 0.07),
      leftCheek: rectangle(x - 0.075, 0.33, 0.045, 0.08),
      rightCheek: rectangle(x + 0.03, 0.33, 0.045, 0.08),
      chest: { x: x - 0.16, y: 0.68, width: 0.32, height: 0.2 },
    };
  }
}
