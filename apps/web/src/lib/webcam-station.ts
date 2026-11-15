import {
  LIVE_VIEW,
  WEBCAM,
  type CameraCommand,
  type CameraState,
  type LiveRegions,
  type PostLiveStateRequest,
  type PostLiveStateResponse,
  type PostWebcamFramesResponse,
  type Reading,
  type SittingKind,
  type SittingResponse,
  type StartSittingRequest,
  type StartSittingResponse,
  type WebcamSittingResponse,
} from '@triagecam/contracts';

import { ApiError } from './api.ts';
import { WebcamError, frameBatch, type WebcamFrame, type WebcamHandlers } from './webcam-capture.ts';

// This computer's webcam in the place of a camera phone. To the server and to the check-in page
// it is a camera device like any other: it reports its state, takes the page's commands from
// the answers, makes the sitting, posts its readings and finishes it, call for call as the
// phone app does (apps/mobile/src/lib/capture). The one difference is where frames are
// measured: a phone runs the capture module and the engine itself; the webcam sends its frames
// to the server, which runs the same region code and the same engine on them and hands back
// the outlines and the readings. No value is made up here: what the engine does not say is not shown.

export const WEBCAM_SITTING_MS = 60_000;
/** What the picker and the device list call it. */
export const WEBCAM_LABEL = 'Webcam';

export const WEBCAM_IDLE: CameraState = {
  phase: 'idle',
  patientNumber: null,
  kind: null,
  sittingId: null,
  viewfinder: null,
  facePresent: false,
  exposureLocked: false,
  error: null,
};

/** The capture module's own rule: after a face was measured on, "lost" for this long, then "searching". */
const LOST_FOR_MS = 10_000;
/** Outlines prompt a state report, as on a phone, about ten times a second. */
const REGIONS_EVERY_MS = 100;
/** Frame requests that may fail in a row before the check-in is stopped. About three seconds of them. */
const FRAME_FAILURES = 6;
const FACE_ENROL_ATTEMPTS = 3;
const SAVE_ATTEMPTS = 3;
const REMEMBERED_COMMANDS = 20;

/** The camera, as the station needs it. `WebcamCapture` in the browser; a stand-in under test. */
export interface StationCamera {
  dropped: number;
  snapshot(): string | null;
  close(): void;
}

/** Every call the station makes. `api` in the browser. */
export interface StationApi {
  postLiveState(deviceId: string, report: PostLiveStateRequest): Promise<PostLiveStateResponse>;
  startSitting(sitting: StartSittingRequest): Promise<StartSittingResponse>;
  postReadings(sittingId: string, readings: Reading[]): Promise<unknown>;
  finishSitting(sittingId: string, finish: { endedAt: string; summary: NonNullable<WebcamSittingResponse['summary']> }): Promise<SittingResponse>;
  abandonSitting(sittingId: string): Promise<unknown>;
  enrolFace(patientNumber: number, jpegBase64: string): Promise<unknown>;
  postWebcamFrames(deviceId: string, frames: Blob, dropped: number, readingsAfter: number): Promise<PostWebcamFramesResponse>;
  webcamSitting(deviceId: string, action: 'start' | 'finish' | 'abandon', sittingId: string): Promise<WebcamSittingResponse>;
  closeWebcam(deviceId: string): Promise<unknown>;
}

export interface StationDeps {
  api: StationApi;
  openCamera: (handlers: WebcamHandlers) => Promise<StationCamera>;
  now?: () => number;
}

type RunningSitting = {
  id: string;
  patientNumber: number;
  startedAt: number;
  /** Every reading the engine has made, in order. */
  readings: Reading[];
  /** How many of them the server has stored. */
  posted: number;
  posting: boolean;
  enrol: { wanted: boolean; attempts: number; busy: boolean };
  timer: ReturnType<typeof setTimeout> | null;
};

const message = (error: unknown, fallback: string) => (error instanceof ApiError || error instanceof WebcamError ? error.message : fallback);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WebcamStation {
  private readonly deviceId: string;
  private readonly api: StationApi;
  private readonly openCamera: StationDeps['openCamera'];
  private readonly now: () => number;
  private readonly listeners = new Set<(state: CameraState) => void>();

  private state: CameraState = WEBCAM_IDLE;
  private regions: LiveRegions | null = null;
  private connected = false;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private reporting = false;
  private reportDue = false;
  private lastRegionsReport = 0;
  private readonly seen: string[] = [];

  private camera: StationCamera | null = null;
  /** Counts every time the camera is given up, so an answer that arrives after it is not acted on. */
  private generation = 0;
  private queue: WebcamFrame[] = [];
  private uploading = false;
  private failures = 0;
  /** Frames that were taken and never reached the server. They count as dropped. */
  private undelivered = 0;
  private measuredAt: number | null = null;
  private sitting: RunningSitting | null = null;

  constructor(deviceId: string, deps: StationDeps) {
    this.deviceId = deviceId;
    this.api = deps.api;
    this.openCamera = deps.openCamera;
    this.now = deps.now ?? (() => Date.now());
  }

  /** What the station is doing, as it tells the server. */
  current(): CameraState {
    return this.state;
  }

  /** Calls `listener` with every new state. Returns the way to stop. */
  subscribe(listener: (state: CameraState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts reporting: the page then sees a connected camera and can send it commands. */
  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.reportTimer = setInterval(() => this.report(), LIVE_VIEW.stateIntervalMs);
    this.report();
  }

  /** Gives up whatever is open and stops reporting. A running sitting is not saved. */
  disconnect(): void {
    if (!this.connected) return;
    this.release();
    this.setState(WEBCAM_IDLE);
    this.connected = false;
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
  }

  // --- the link to the check-in page: state up, commands down ------------------------------------

  private setState(next: Partial<CameraState>): void {
    const merged = { ...this.state, ...next };
    const same = (Object.keys(merged) as (keyof CameraState)[]).every((key) => merged[key] === this.state[key]);
    if (same) return;
    this.state = merged;
    if (merged.phase === 'idle') this.regions = null;
    for (const listener of [...this.listeners]) listener(merged);
    this.report();
  }

  /** One report in flight at most; a change meanwhile is sent, newest only, when the answer is back. */
  private report(): void {
    if (!this.connected) return;
    if (this.reporting) {
      this.reportDue = true;
      return;
    }
    this.reporting = true;
    this.reportDue = false;
    this.api
      .postLiveState(this.deviceId, { state: this.state, regions: this.regions })
      .then((answer) => {
        if (this.connected && answer.command) this.receive(answer.command);
      })
      // A report that did not get through is not retried: the next one says more.
      .catch(() => {})
      .finally(() => {
        this.reporting = false;
        if (this.reportDue) this.report();
      });
  }

  private receive(command: CameraCommand): void {
    if (this.seen.includes(command.id)) return;
    this.seen.push(command.id);
    if (this.seen.length > REMEMBERED_COMMANDS) this.seen.shift();
    const { phase } = this.state;
    if (command.type === 'open') {
      if (command.patientNumber === null || command.kind === null) return;
      if (phase === 'starting' || phase === 'running' || phase === 'stopping') return;
      // The camera is already on and waiting: the check-in changes hands, the camera stays.
      if (phase === 'framing') return this.setState({ patientNumber: command.patientNumber, kind: command.kind, error: null });
      void this.open(command.patientNumber, command.kind);
    } else if (command.type === 'start') void this.start(command.enrolFace);
    else if (command.type === 'stop') void this.stop();
    else if (phase !== 'idle') this.cancel();
  }

  // --- the camera ----------------------------------------------------------------------------------

  private async open(patientNumber: number, kind: SittingKind): Promise<void> {
    this.release();
    const generation = this.generation;
    this.setState({ ...WEBCAM_IDLE, phase: 'preparing', patientNumber, kind });
    let camera: StationCamera;
    try {
      camera = await this.openCamera({
        accepts: () => this.queue.length < WEBCAM.maxQueuedFrames,
        onFrame: (frame) => {
          if (generation !== this.generation) return;
          this.queue.push(frame);
          this.pump();
        },
        onLost: () => {
          if (generation === this.generation) this.stopWith('The webcam stopped sending a picture. Close this check-in and try again.');
        },
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const denied = error instanceof WebcamError && error.kind === 'permission_denied';
      return this.setState({ phase: denied ? 'permission_denied' : 'unavailable', error: message(error, 'The webcam could not be started.') });
    }
    // Called off while the browser was asking for permission.
    if (generation !== this.generation) return camera.close();
    this.camera = camera;
    this.setState({ phase: 'framing' });
  }

  /** Turns the camera off and forgets everything that belonged to it. A running sitting is abandoned. */
  private release(): void {
    this.generation += 1;
    const sitting = this.sitting;
    this.sitting = null;
    if (sitting) {
      if (sitting.timer) clearTimeout(sitting.timer);
      void this.api.webcamSitting(this.deviceId, 'abandon', sitting.id).catch(() => {});
      void this.api.abandonSitting(sitting.id).catch(() => {});
    }
    if (this.camera) {
      this.camera.close();
      this.camera = null;
      void this.api.closeWebcam(this.deviceId).catch(() => {});
    }
    this.queue = [];
    this.failures = 0;
    this.undelivered = 0;
    this.measuredAt = null;
    this.regions = null;
  }

  /** The camera or the engine behind it has failed: the check-in stops where it is and says why. */
  private stopWith(error: string): void {
    const { patientNumber, kind } = this.state;
    this.release();
    this.setState({ ...WEBCAM_IDLE, phase: 'unavailable', patientNumber, kind, error });
  }

  private cancel(): void {
    this.release();
    this.setState(WEBCAM_IDLE);
  }

  // --- frames up, outlines and readings back ---------------------------------------------------------

  /** One request in flight, carrying every frame taken since the last, in order. */
  private pump(): void {
    const camera = this.camera;
    if (this.uploading || this.queue.length === 0 || !camera) return;
    const generation = this.generation;
    const frames = this.queue;
    this.queue = [];
    this.uploading = true;
    this.api
      .postWebcamFrames(this.deviceId, frameBatch(frames), camera.dropped + this.undelivered, this.sitting?.readings.length ?? 0)
      .then((answer) => {
        if (generation !== this.generation) return;
        this.failures = 0;
        this.absorb(answer);
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.undelivered += frames.length;
        this.failures += 1;
        if (error instanceof ApiError && error.code === 'engine_unavailable') this.stopWith(error.message);
        else if (this.failures >= FRAME_FAILURES) this.stopWith(message(error, 'The webcam picture is not reaching the server. Close this check-in and try again.'));
      })
      .finally(() => {
        this.uploading = false;
        this.pump();
      });
  }

  private absorb(answer: PostWebcamFramesResponse): void {
    const now = this.now();
    this.regions = answer.outlines;
    let viewfinder: CameraState['viewfinder'];
    if (answer.facePresent) {
      viewfinder = answer.exposureLocked ? 'measuring' : 'locking';
      if (answer.exposureLocked) this.measuredAt = now;
    } else if (this.measuredAt !== null && now - this.measuredAt <= LOST_FOR_MS) viewfinder = 'lost';
    else {
      this.measuredAt = null;
      viewfinder = 'searching';
    }
    const before = this.state;
    this.setState({ facePresent: answer.facePresent, exposureLocked: answer.exposureLocked, viewfinder });
    // The outlines moved even when the state did not: they ride up on a report of their own.
    if (before === this.state && now - this.lastRegionsReport >= REGIONS_EVERY_MS) {
      this.lastRegionsReport = now;
      this.report();
    }

    const sitting = this.sitting;
    if (!sitting || answer.sittingId !== sitting.id || this.state.phase !== 'running') return;
    if (answer.readings.length > 0) {
      sitting.readings.push(...answer.readings);
      this.postReadings(sitting);
    }
    if (viewfinder === 'measuring') void this.enrol(sitting);
    const last = sitting.readings[sitting.readings.length - 1];
    if (last && last.elapsedMs >= WEBCAM_SITTING_MS) void this.stop();
  }

  /** Readings go up as they come. One that did not get through goes with the next, 30 at most at a time. */
  private postReadings(sitting: RunningSitting): void {
    if (sitting.posting || sitting.posted >= sitting.readings.length) return;
    const batch = sitting.readings.slice(sitting.posted, sitting.posted + 30);
    sitting.posting = true;
    this.api
      .postReadings(sitting.id, batch)
      .then(() => {
        sitting.posted += batch.length;
      })
      .catch(() => {})
      .finally(() => {
        sitting.posting = false;
      });
  }

  /** Face match was asked for with Start: the newest frame goes to the enrolment route, which finds the face in it. */
  private async enrol(sitting: RunningSitting): Promise<void> {
    const { enrol } = sitting;
    if (!enrol.wanted || enrol.busy || enrol.attempts >= FACE_ENROL_ATTEMPTS) return;
    const picture = this.camera?.snapshot();
    if (!picture) return;
    enrol.busy = true;
    enrol.attempts += 1;
    try {
      await this.api.enrolFace(sitting.patientNumber, picture);
      enrol.wanted = false;
    } catch (error) {
      // No face in that frame: another try on a later one. Anything else will not pass by trying again.
      if (!(error instanceof ApiError && error.code === 'no_face_detected')) enrol.wanted = false;
    } finally {
      enrol.busy = false;
    }
  }

  // --- the sitting ---------------------------------------------------------------------------------

  private async start(enrolFace: boolean): Promise<void> {
    const { phase, patientNumber, kind } = this.state;
    if (phase !== 'framing' || patientNumber === null || kind === null || this.sitting) return;
    const generation = this.generation;
    this.setState({ phase: 'starting', error: null });
    let id: string | null = null;
    try {
      const made = await this.api.startSitting({ patientNumber, deviceId: this.deviceId, kind, source: 'camera', clientTime: new Date(this.now()).toISOString() });
      id = made.sitting.id;
      if (generation === this.generation) await this.api.webcamSitting(this.deviceId, 'start', id);
      if (generation !== this.generation) {
        // Called off while the sitting was being made.
        void this.api.webcamSitting(this.deviceId, 'abandon', id).catch(() => {});
        return void this.api.abandonSitting(id).catch(() => {});
      }
    } catch (error) {
      if (id) void this.api.abandonSitting(id).catch(() => {});
      if (generation !== this.generation) return;
      return this.setState({ phase: 'framing', error: message(error, 'The sitting could not be started. Try again.') });
    }
    const sitting: RunningSitting = {
      id,
      patientNumber,
      startedAt: this.now(),
      readings: [],
      posted: 0,
      posting: false,
      enrol: { wanted: enrolFace, attempts: 0, busy: false },
      timer: null,
    };
    // The engine's own clock ends the sitting; this is for a camera that goes quiet near the end.
    sitting.timer = setTimeout(() => void this.stop(), WEBCAM_SITTING_MS + 2500);
    this.sitting = sitting;
    this.setState({ phase: 'running', sittingId: id });
  }

  /** Ends the sitting and saves it: the engine's summary goes to the finish route, as a phone's does. */
  private async stop(): Promise<void> {
    const sitting = this.sitting;
    if (!sitting || this.state.phase !== 'running') return;
    const generation = this.generation;
    if (sitting.timer) clearTimeout(sitting.timer);
    this.setState({ phase: 'stopping' });
    try {
      const { summary, endedAt, readings } = await this.api.webcamSitting(this.deviceId, 'finish', sitting.id);
      if (generation !== this.generation) return;
      if (!summary || !endedAt) throw new ApiError('bad_response', 'The engine returned no summary.');
      // Readings first: the server takes none once the sitting is finished.
      const rest = readings.slice(sitting.readings.length);
      sitting.readings.push(...rest);
      for (let attempt = 0; sitting.posted < sitting.readings.length && attempt < SAVE_ATTEMPTS + 2; attempt += 1) {
        while (sitting.posting) await wait(50);
        const batch = sitting.readings.slice(sitting.posted, sitting.posted + 30);
        await this.api.postReadings(sitting.id, batch).then(
          () => {
            sitting.posted += batch.length;
          },
          () => wait(300),
        );
      }
      for (let attempt = 1; ; attempt += 1) {
        try {
          await this.api.finishSitting(sitting.id, { endedAt, summary });
          break;
        } catch (error) {
          if (attempt >= SAVE_ATTEMPTS) throw error;
          await wait(500);
        }
      }
    } catch (error) {
      if (generation !== this.generation) return;
      // release() abandons the sitting on the server, so the page does not wait for a summary.
      return this.stopWith(`The sitting could not be saved. ${message(error, 'Close this check-in and start again.')}`);
    }
    if (generation !== this.generation) return;
    // Saved. Nothing is left to abandon: the camera goes off and the station is ready for the next patient.
    this.sitting = null;
    this.release();
    this.setState(WEBCAM_IDLE);
  }
}
