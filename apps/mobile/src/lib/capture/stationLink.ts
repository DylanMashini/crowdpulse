import {
  LIVE_VIEW,
  type CameraCommand,
  type CameraState,
  type LiveRegions,
  type PostLiveStateRequest,
  type PostLiveStateResponse,
} from '@triagecam/contracts';

// The phone's end of the check-in page. While the camera role is open the phone tells the
// server what its screen is doing and, with the camera on, the outlines it is measuring on;
// each answer may carry a command from the dashboard (open a check-in, start, end, call off).
// docs/CONTRACTS.md, section 4, "Live view".

/** The camera role with no sitting screen open. */
export const IDLE_STATE: CameraState = {
  phase: 'idle',
  patientNumber: null,
  kind: null,
  sittingId: null,
  viewfinder: null,
  facePresent: false,
  exposureLocked: false,
  error: null,
};

export type StationTransport = (deviceId: string, report: PostLiveStateRequest) => Promise<PostLiveStateResponse>;
export type CommandHandler = (command: CameraCommand) => void;

type Timers = {
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (timer: unknown) => void;
};

const realTimers: Timers = {
  setInterval: (run, ms) => setInterval(run, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

/** Command ids already carried out. A handful is plenty: the server hands each one over once. */
const REMEMBERED_COMMANDS = 20;

const sameState = (a: CameraState, b: CameraState) =>
  a.phase === b.phase &&
  a.patientNumber === b.patientNumber &&
  a.kind === b.kind &&
  a.sittingId === b.sittingId &&
  a.viewfinder === b.viewfinder &&
  a.facePresent === b.facePresent &&
  a.exposureLocked === b.exposureLocked &&
  a.error === b.error;

/**
 * Reports to the server and listens for commands in the answers. One request is in flight at
 * most: a change that arrives meanwhile is sent, newest only, as soon as the answer is back, so
 * a slow network thins the reports out and never queues them.
 */
export class StationLink {
  private deviceId: string | null = null;
  private state: CameraState = IDLE_STATE;
  private regions: LiveRegions | null = null;
  private inFlight = false;
  private dirty = false;
  private timer: unknown = null;
  private readonly seen: string[] = [];
  private readonly handlers = new Set<CommandHandler>();
  private readonly post: StationTransport;
  private readonly timers: Timers;

  constructor(post: StationTransport, timers: Timers = realTimers) {
    this.post = post;
    this.timers = timers;
  }

  /** Starts reporting for this device: now, on every change, and once a second regardless. */
  connect(deviceId: string): void {
    if (this.deviceId === deviceId) return;
    this.disconnect();
    this.deviceId = deviceId;
    this.timer = this.timers.setInterval(() => this.send(), LIVE_VIEW.stateIntervalMs);
    this.send();
  }

  /** Stops reporting. The server forgets the phone a few seconds later. */
  disconnect(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.deviceId = null;
    this.dirty = false;
  }

  /** What the screen is doing. Sent at once when it differs from the last state. */
  setState(state: CameraState): void {
    if (sameState(this.state, state)) return;
    this.state = state;
    // Outlines belong to a camera that is on.
    if (state.phase === 'idle') this.regions = null;
    this.send();
  }

  /** The newest outlines from the capture module. Each one prompts a report. */
  setRegions(regions: LiveRegions | null): void {
    this.regions = regions;
    this.send();
  }

  /** Calls `handler` once for each command from the dashboard. Returns the way to stop. */
  onCommand(handler: CommandHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private send(): void {
    const deviceId = this.deviceId;
    if (!deviceId) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.inFlight = true;
    this.dirty = false;
    this.post(deviceId, { state: this.state, regions: this.regions })
      .then((answer) => {
        if (this.deviceId === deviceId && answer.command) this.receive(answer.command);
      })
      // A report that did not get through is not retried: the next one says more.
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
        if (this.dirty) this.send();
      });
  }

  private receive(command: CameraCommand): void {
    if (this.seen.includes(command.id)) return;
    this.seen.push(command.id);
    if (this.seen.length > REMEMBERED_COMMANDS) this.seen.shift();
    for (const handler of [...this.handlers]) handler(command);
  }
}
