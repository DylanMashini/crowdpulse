import { type FinishSittingRequest, type Reading, type Sitting, SittingResponse } from '@triagecam/contracts';

/** The server takes at most this many readings in one request. */
export const MAX_BATCH = 30;
/** Readings kept while the network is down. A sitting is 60 readings, so this is never reached in one. */
export const MAX_QUEUED = 300;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

export type UploadTransport = {
  postReadings: (readings: Reading[]) => Promise<unknown>;
  postFinish: (request: FinishSittingRequest) => Promise<unknown>;
};

export type UploadState = {
  /** Readings waiting to be sent. */
  pendingReadings: number;
  sentReadings: number;
  /** Readings the server refused, or that were pushed out of a full queue. */
  droppedReadings: number;
  /** `idle` until finish() is called; `failed` when the server refused the summary for good. */
  finish: 'idle' | 'pending' | 'sent' | 'failed';
  /**
   * The summary as the station stored it, once it answered. A check-in can differ from what the
   * phone sent: a vital the engine did not record is taken from the readings shown live.
   */
  saved: Sitting['summary'];
  /** The last failure, cleared by the next success. */
  error: string | null;
  /** True while the queue is waiting to retry after a failure. */
  waitingToRetry: boolean;
};

export type UploadQueueOptions = {
  transport: UploadTransport;
  /** Whether the same request can succeed later. Anything else is dropped so it cannot block the queue. */
  isRetryable: (error: unknown) => boolean;
  describe: (error: unknown) => string;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Sends one sitting's readings, then its summary, in order. Nothing here is awaited by the
 * sitting: enqueue() and finish() return at once and the queue keeps trying in the background.
 */
export class SittingUploadQueue {
  private readonly readings: Reading[] = [];
  private finishRequest: FinishSittingRequest | null = null;
  private inFlight = 0;
  private pumping = false;
  private attempt = 0;
  private retryTimer: unknown = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private state: UploadState = {
    pendingReadings: 0,
    sentReadings: 0,
    droppedReadings: 0,
    finish: 'idle',
    saved: null,
    error: null,
    waitingToRetry: false,
  };

  private readonly options: UploadQueueOptions;

  constructor(options: UploadQueueOptions) {
    this.options = options;
  }

  getState = (): UploadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  enqueue(reading: Reading): void {
    this.readings.push(reading);
    if (this.readings.length > MAX_QUEUED) {
      // Drop the oldest reading that is not part of the request in the air.
      this.readings.splice(this.inFlight, 1);
      this.update({ droppedReadings: this.state.droppedReadings + 1 });
    }
    this.update({});
    this.flush();
  }

  /** Queues the summary. It is sent once every reading before it has been sent or dropped. */
  finish(request: FinishSittingRequest): void {
    this.finishRequest = request;
    this.update({ finish: 'pending' });
    this.flush();
  }

  /** Tries now instead of waiting for the retry timer. */
  flush(): void {
    this.cancelRetry();
    void this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelRetry();
    this.listeners.clear();
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      while (!this.disposed) {
        if (this.readings.length > 0) {
          const batch = this.readings.slice(0, MAX_BATCH);
          this.inFlight = batch.length;
          try {
            await this.options.transport.postReadings(batch);
          } catch (error) {
            this.inFlight = 0;
            if (this.options.isRetryable(error)) return this.retryLater(error);
            this.readings.splice(0, batch.length);
            this.update({
              droppedReadings: this.state.droppedReadings + batch.length,
              error: this.options.describe(error),
            });
            continue;
          }
          this.inFlight = 0;
          this.readings.splice(0, batch.length);
          this.attempt = 0;
          this.update({ sentReadings: this.state.sentReadings + batch.length, error: null });
        } else if (this.finishRequest && this.state.finish === 'pending') {
          let answer: unknown;
          try {
            answer = await this.options.transport.postFinish(this.finishRequest);
          } catch (error) {
            if (this.options.isRetryable(error)) return this.retryLater(error);
            this.update({ finish: 'failed', error: this.options.describe(error) });
            return;
          }
          this.attempt = 0;
          const stored = SittingResponse.safeParse(answer);
          this.update({ finish: 'sent', error: null, saved: stored.success ? stored.data.sitting.summary : null });
        } else {
          return;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private retryLater(error: unknown): void {
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)]!;
    this.attempt += 1;
    const setTimer = this.options.setTimer ?? setTimeout;
    this.retryTimer = setTimer(() => {
      this.retryTimer = null;
      this.update({ waitingToRetry: false });
      void this.pump();
    }, delay);
    this.update({ error: this.options.describe(error), waitingToRetry: true });
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    (this.options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.retryTimer);
    this.retryTimer = null;
    this.update({ waitingToRetry: false });
  }

  private update(patch: Partial<UploadState>): void {
    this.state = { ...this.state, ...patch, pendingReadings: this.readings.length };
    for (const listener of this.listeners) listener();
  }
}
