import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CameraCommand, CameraState, PostWebcamFramesResponse, Reading, SittingSummary } from '@triagecam/contracts';

import { ApiError } from './api.ts';
import { WebcamError, frameBatch, sendSize, type WebcamHandlers } from './webcam-capture.ts';
import { WEBCAM_IDLE, WEBCAM_SITTING_MS, WebcamStation, type StationApi } from './webcam-station.ts';

const DEVICE = '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c11';
const SITTING = '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c21';
const settling = { value: null, state: 'settling' as const, reason: 'warming_up' as const, quality: 0, coverage: 0, ageMs: null };
const reading = (elapsedMs: number): Reading => ({
  t: new Date(1_794_728_373_000 + elapsedMs).toISOString(),
  elapsedMs,
  heartRate: { value: 86, state: 'valid', reason: null, quality: 0.7, coverage: 0.8, ageMs: 0 },
  breathingRate: settling,
});
const SUMMARY: SittingSummary = {
  durationSeconds: 60,
  frameCount: 1800,
  droppedFrames: 0,
  heartRate: { value: 86, coverage: 0.8 },
  breathingRate: { value: null, coverage: 0 },
  rmssd: { value: null, coverage: 0 },
  sdnn: { value: null, coverage: 0 },
  beatIntervals: [],
  timeToFirstReadingSeconds: 8,
  longestDropoutSeconds: 1,
  heartRateConfidence: 'normal',
};
const face = { x: 0.4, y: 0.2, width: 0.2, height: 0.3 };
const seen = (overrides: Partial<PostWebcamFramesResponse> = {}): PostWebcamFramesResponse => ({
  viewers: 1,
  outlines: { aspectRatio: 4 / 3, face, forehead: null, leftCheek: null, rightCheek: null, chest: null },
  facePresent: true,
  exposureLocked: true,
  sittingId: null,
  readings: [],
  ...overrides,
});

/** A server and a camera that do what the test says, and note every call the station makes. */
function rig(options: { camera?: 'ok' | WebcamError } = {}) {
  const calls: string[] = [];
  const commands: CameraCommand[] = [];
  const posted: Reading[] = [];
  /** Every reading the engine has made, as the server keeps them for the finish. */
  const made: Reading[] = [];
  let handlers: WebcamHandlers | null = null;
  let closed = 0;
  let answer = seen();
  let framesFail: Error | null = null;
  let finished: { endedAt: string; summary: SittingSummary } | null = null;
  const sitting = { id: SITTING, patientNumber: 14, deviceId: DEVICE, kind: 'check_in' as const, source: 'camera' as const, startedAt: '2026-11-15T07:39:33.000Z', endedAt: null, clockOffsetMs: 0, summary: null };
  const api: StationApi = {
    postLiveState: async (_device, report) => {
      calls.push(`state:${report.state.phase}`);
      return { viewers: 1, command: commands.shift() ?? null };
    },
    startSitting: async (request) => {
      calls.push(`start:${request.patientNumber}:${request.kind}:${request.source}`);
      return { sitting, serverTime: sitting.startedAt };
    },
    postReadings: async (_id, readings) => {
      posted.push(...readings);
    },
    finishSitting: async (_id, finish) => {
      calls.push('finish');
      finished = finish;
      return { sitting: { ...sitting, endedAt: finish.endedAt } };
    },
    abandonSitting: async () => {
      calls.push('abandon');
    },
    enrolFace: async (number) => {
      calls.push(`enrol:${number}`);
    },
    postWebcamFrames: async () => {
      if (framesFail) throw framesFail;
      return answer;
    },
    webcamSitting: async (_device, action) => {
      calls.push(`engine:${action}`);
      return action === 'finish'
        ? { summary: SUMMARY, endedAt: '2026-11-15T07:40:33.000Z', readings: [...made] }
        : { summary: null, endedAt: null, readings: [] };
    },
    closeWebcam: async () => {
      calls.push('close');
    },
  };
  const station = new WebcamStation(DEVICE, {
    api,
    openCamera: async (given) => {
      if (options.camera instanceof WebcamError) throw options.camera;
      handlers = given;
      return { dropped: 0, snapshot: () => 'anVzdCBhIHBpY3R1cmU=', close: () => void (closed += 1) };
    },
  });
  const states: CameraState[] = [];
  station.subscribe((state) => states.push(state));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    station,
    calls,
    states,
    posted,
    settle,
    closed: () => closed,
    finished: () => finished,
    /** A command from the check-in page, waiting for the station's next state report. */
    queue: (type: CameraCommand['type'], extra: Partial<CameraCommand> = {}) => {
      commands.push({ id: crypto.randomUUID(), type, patientNumber: null, kind: null, enrolFace: false, ...extra });
    },
    /** The same, for a station with nothing open: a reconnect makes it report at once. */
    command: async (type: CameraCommand['type'], extra: Partial<CameraCommand> = {}) => {
      commands.push({ id: crypto.randomUUID(), type, patientNumber: null, kind: null, enrolFace: false, ...extra });
      station.disconnect();
      station.connect();
      await settle();
    },
    /** One camera frame goes up and the server answers with `next`. */
    frame: async (next: PostWebcamFramesResponse) => {
      answer = next;
      made.push(...next.readings);
      handlers?.onFrame({ jpeg: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]), capturedAtMs: Date.now() });
      await settle();
    },
    failFrames: (error: Error | null) => {
      framesFail = error;
    },
    lose: () => handlers?.onLost(),
  };
}

test('a check-in on the webcam makes the calls a phone makes, in a phone\'s order', async () => {
  const r = rig();
  r.station.connect();
  await r.settle();
  assert.equal(r.station.current().phase, 'idle');

  await r.command('open', { patientNumber: 14, kind: 'check_in' });
  assert.equal(r.station.current().phase, 'framing');
  assert.equal(r.station.current().patientNumber, 14);

  await r.frame(seen());
  assert.deepEqual(
    { face: r.station.current().facePresent, locked: r.station.current().exposureLocked, viewfinder: r.station.current().viewfinder },
    { face: true, locked: true, viewfinder: 'measuring' },
  );

  // The command rides down on the state report that the next change prompts.
  r.queue('start', { enrolFace: true });
  await r.frame(seen({ facePresent: false }));
  await r.settle();
  assert.equal(r.station.current().phase, 'running');
  assert.equal(r.station.current().sittingId, SITTING);
  assert.equal(r.station.current().viewfinder, 'lost');

  await r.frame(seen({ sittingId: SITTING, readings: [reading(1000), reading(2000)] }));
  assert.deepEqual(r.posted.map((one) => one.elapsedMs), [1000, 2000]);
  assert.ok(r.calls.includes('enrol:14'));

  // The engine's own clock ends the sitting: the reading at 60 seconds.
  await r.frame(seen({ sittingId: SITTING, readings: [reading(59_000)] }));
  assert.equal(r.station.current().phase, 'running');
  await r.frame(seen({ sittingId: SITTING, readings: [reading(WEBCAM_SITTING_MS)] }));
  for (let tries = 0; r.station.current().phase !== 'idle' && tries < 100; tries += 1) await r.settle();
  assert.equal(r.station.current().phase, 'idle');
  assert.deepEqual(r.finished(), { endedAt: '2026-11-15T07:40:33.000Z', summary: SUMMARY });
  assert.equal(r.closed(), 1);
  // Made on the sittings route as a camera sitting, readings before the finish, nothing abandoned.
  const order = r.calls.filter((call) => !call.startsWith('state:') && !call.startsWith('enrol'));
  assert.deepEqual(order, ['start:14:check_in:camera', 'engine:start', 'engine:finish', 'finish', 'close']);
  assert.equal(new Set(r.posted.map((one) => one.t)).size, r.posted.length);
  assert.equal(r.posted[r.posted.length - 1]?.elapsedMs, WEBCAM_SITTING_MS);
  r.station.disconnect();
});

test('a refused or missing camera is a phase the page can show, and closing it goes back to idle', async () => {
  for (const [error, phase] of [
    [new WebcamError('permission_denied', 'The browser has not been allowed to use the camera.'), 'permission_denied'],
    [new WebcamError('no_camera', 'No camera was found on this computer.'), 'unavailable'],
  ] as const) {
    const r = rig({ camera: error });
    r.station.connect();
    await r.command('open', { patientNumber: 14, kind: 'check_in' });
    assert.equal(r.station.current().phase, phase);
    assert.equal(r.station.current().error, error.message);
    assert.equal(r.station.current().patientNumber, 14);
    await r.command('cancel');
    assert.deepEqual(r.station.current(), WEBCAM_IDLE);
    r.station.disconnect();
  }
});

test('a camera lost mid-sitting abandons the sitting and says so', async () => {
  const r = rig();
  const inner = r.station as unknown as { start(enrolFace: boolean): Promise<void> };
  r.station.connect();
  await r.command('open', { patientNumber: 14, kind: 'recheck' });
  await inner.start(false);
  assert.equal(r.station.current().phase, 'running');

  r.lose();
  await r.settle();
  assert.equal(r.station.current().phase, 'unavailable');
  assert.match(r.station.current().error ?? '', /stopped sending a picture/);
  assert.equal(r.station.current().sittingId, null);
  assert.ok(r.calls.includes('engine:abandon') && r.calls.includes('abandon'));
  assert.equal(r.calls.includes('finish'), false);
  r.station.disconnect();
});

test('an engine that is not there stops the check-in with the server\'s own sentence', async () => {
  const r = rig();
  r.station.connect();
  await r.command('open', { patientNumber: 14, kind: 'check_in' });
  r.failFrames(new ApiError('engine_unavailable', 'The measuring engine for the webcam is not built on this server. Run pnpm webcam:build, then try again.', 503));
  await r.frame(seen());
  assert.equal(r.station.current().phase, 'unavailable');
  assert.match(r.station.current().error ?? '', /pnpm webcam:build/);
  assert.equal(r.closed(), 1);
  r.station.disconnect();
});

test('frames are sent at the camera\'s size up to 640 px, each behind its capture time and length', async () => {
  assert.deepEqual(sendSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(sendSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(sendSize(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(sendSize(321, 241), { width: 322, height: 242 });

  const jpeg = new Uint8Array([0xff, 0xd8, 0x07, 0xff, 0xd9]);
  const body = Buffer.from(await frameBatch([
    { jpeg: new Blob([jpeg]), capturedAtMs: 1_794_728_373_720.5 },
    { jpeg: new Blob([jpeg]), capturedAtMs: 1_794_728_373_754.25 },
  ]).arrayBuffer());
  assert.equal(body.byteLength, 2 * (12 + jpeg.byteLength));
  assert.equal(body.readDoubleLE(0), 1_794_728_373_720.5);
  assert.equal(body.readUInt32LE(8), jpeg.byteLength);
  assert.equal(body.readDoubleLE(12 + jpeg.byteLength), 1_794_728_373_754.25);
});
