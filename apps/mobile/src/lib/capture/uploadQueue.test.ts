/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FinishSittingRequest, Reading } from '@triagecam/contracts';

import { MAX_BATCH, MAX_QUEUED, SittingUploadQueue } from './uploadQueue.ts';

class Offline extends Error {}
class Refused extends Error {}

function reading(second: number): Reading {
  const estimate = { value: null, state: 'settling' as const, reason: 'warming_up' as const, quality: 0, coverage: 0, ageMs: null };
  return {
    t: new Date(Date.UTC(2026, 10, 14, 3, 0, second)).toISOString(),
    elapsedMs: second * 1000,
    heartRate: estimate,
    breathingRate: estimate,
  };
}

const none = { value: null, coverage: 0 };
const finishRequest: FinishSittingRequest = {
  endedAt: '2026-11-14T03:01:00.000Z',
  summary: {
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
    heartRate: { value: 72, coverage: 0.8 },
    breathingRate: none,
    rmssd: none,
    sdnn: none,
    beatIntervals: [{ tMs: 900, ms: 830 }],
    timeToFirstReadingSeconds: 11,
    longestDropoutSeconds: 0,
  },
};

/** A server and a clock the test controls. */
function harness() {
  const log: string[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  let failWith: Error | null = null;
  let gate: Promise<void> | null = null;
  const queue = new SittingUploadQueue({
    transport: {
      async postReadings(readings) {
        if (gate) await gate;
        if (failWith) throw failWith;
        log.push(`readings:${readings.map((r) => r.elapsedMs / 1000).join(',')}`);
      },
      async postFinish(request) {
        if (failWith) throw failWith;
        log.push(`finish:${request.summary.heartRate.value}`);
      },
    },
    isRetryable: (error) => error instanceof Offline,
    describe: (error) => (error as Error).message,
    setTimer: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return {
    queue,
    log,
    timers,
    fail: (error: Error | null) => (failWith = error),
    /** Holds postReadings in the air until the returned function is called. */
    hold() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    fireTimer() {
      const timer = timers.shift();
      assert.ok(timer, 'expected a retry to be scheduled');
      timer.callback();
    },
    settle: () => new Promise<void>((resolve) => setImmediate(resolve)),
  };
}

test('a reading is sent as soon as it is queued', async () => {
  const h = harness();
  h.queue.enqueue(reading(1));
  await h.settle();
  assert.deepEqual(h.log, ['readings:1']);
  assert.deepEqual(
    { pending: h.queue.getState().pendingReadings, sent: h.queue.getState().sentReadings },
    { pending: 0, sent: 1 },
  );
});

test('enqueue returns at once while the network hangs', async () => {
  const h = harness();
  const release = h.hold();
  h.queue.enqueue(reading(1));
  h.queue.enqueue(reading(2));
  h.queue.enqueue(reading(3));
  assert.equal(h.queue.getState().pendingReadings, 3);
  release();
  await h.settle();
  // Readings that arrived while the first was in the air go out together, in order.
  assert.deepEqual(h.log, ['readings:1', 'readings:2,3']);
});

test('readings kept through a network drop go out with the next one, oldest first', async () => {
  const h = harness();
  h.fail(new Offline('Cannot reach the server at https://x'));
  h.queue.enqueue(reading(1));
  await h.settle();
  h.queue.enqueue(reading(2));
  await h.settle();
  assert.deepEqual(h.log, []);
  assert.equal(h.queue.getState().pendingReadings, 2);
  assert.equal(h.queue.getState().error, 'Cannot reach the server at https://x');
  assert.equal(h.queue.getState().waitingToRetry, true);

  h.fail(null);
  h.queue.enqueue(reading(3));
  await h.settle();
  assert.deepEqual(h.log, ['readings:1,2,3']);
  assert.equal(h.queue.getState().error, null);
  assert.equal(h.queue.getState().waitingToRetry, false);
  assert.equal(h.timers.length, 0, 'the retry timer is cancelled once a send succeeds');
});

test('retries on a timer with a growing delay when no new reading arrives', async () => {
  const h = harness();
  h.fail(new Offline('offline'));
  h.queue.enqueue(reading(1));
  await h.settle();
  assert.equal(h.timers[0]!.ms, 1000);
  h.fireTimer();
  await h.settle();
  assert.equal(h.timers[0]!.ms, 2000);
  h.fail(null);
  h.fireTimer();
  await h.settle();
  assert.deepEqual(h.log, ['readings:1']);
});

test('a long gap is caught up in batches of at most 30', async () => {
  const h = harness();
  h.fail(new Offline('offline'));
  for (let second = 1; second <= 45; second += 1) h.queue.enqueue(reading(second));
  await h.settle();
  h.fail(null);
  h.queue.flush();
  await h.settle();
  assert.equal(h.log.length, 2);
  assert.equal(h.log[0]!.split(',').length, MAX_BATCH);
  assert.equal(h.log[1]!.split(',').length, 15);
});

test('the summary waits for every reading, then is sent once', async () => {
  const h = harness();
  h.fail(new Offline('offline'));
  h.queue.enqueue(reading(59));
  h.queue.enqueue(reading(60));
  h.queue.finish(finishRequest);
  await h.settle();
  assert.equal(h.queue.getState().finish, 'pending');
  assert.deepEqual(h.log, []);

  h.fail(null);
  h.fireTimer();
  await h.settle();
  assert.deepEqual(h.log, ['readings:59,60', 'finish:72']);
  assert.equal(h.queue.getState().finish, 'sent');

  h.queue.flush();
  await h.settle();
  assert.equal(h.log.length, 2, 'a sent summary is not sent again');
});

test('a batch the server refuses is dropped so it cannot block the summary', async () => {
  const h = harness();
  h.fail(new Refused('This sitting has already been finished'));
  h.queue.enqueue(reading(1));
  await h.settle();
  assert.equal(h.queue.getState().pendingReadings, 0);
  assert.equal(h.queue.getState().droppedReadings, 1);
  assert.equal(h.queue.getState().error, 'This sitting has already been finished');
  assert.equal(h.timers.length, 0);

  h.fail(null);
  h.queue.finish(finishRequest);
  await h.settle();
  assert.deepEqual(h.log, ['finish:72']);
});

test('a summary the server refuses is marked failed and not retried', async () => {
  const h = harness();
  h.fail(new Refused('The summary is not valid'));
  h.queue.finish(finishRequest);
  await h.settle();
  assert.equal(h.queue.getState().finish, 'failed');
  assert.equal(h.queue.getState().error, 'The summary is not valid');
  assert.equal(h.timers.length, 0);
});

test('a full queue drops its oldest waiting readings, never the newest or the one in the air', async () => {
  const h = harness();
  h.fail(new Offline('offline'));
  for (let second = 1; second <= MAX_QUEUED + 2; second += 1) h.queue.enqueue(reading(second));
  await h.settle();
  assert.equal(h.queue.getState().pendingReadings, MAX_QUEUED);
  assert.equal(h.queue.getState().droppedReadings, 2);
  h.fail(null);
  h.queue.flush();
  await h.settle();
  // Reading 1 was already in the air when the queue filled, so 2 and 3 are the ones dropped.
  assert.equal(h.log[0]!.startsWith('readings:1,4,5,'), true);
  assert.equal(h.log.at(-1)!.endsWith(`,${MAX_QUEUED + 2}`), true);
});

test('subscribers hear every change and nothing after dispose', async () => {
  const h = harness();
  let changes = 0;
  h.queue.subscribe(() => (changes += 1));
  h.queue.enqueue(reading(1));
  await h.settle();
  assert.ok(changes >= 2);
  h.queue.dispose();
  const before = changes;
  h.queue.enqueue(reading(2));
  await h.settle();
  assert.equal(changes, before);
  assert.deepEqual(h.log, ['readings:1']);
});

test('the queue keeps the summary the station stored, which can differ from the one sent', async () => {
  const h = harness();
  h.queue.finish(finishRequest);
  await h.settle();
  assert.equal(h.queue.getState().finish, 'sent');
  assert.equal(h.queue.getState().saved, null, 'an answer that is not a sitting leaves nothing to show');

  const stored = {
    durationSeconds: 60,
    heartRate: { value: 74, coverage: 0 },
    breathingRate: none,
    rmssd: none,
    sdnn: none,
    timeToFirstReadingSeconds: null,
    longestDropoutSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
    heartRateConfidence: 'normal' as const,
    heartRateFromLive: true,
    breathingRateFromLive: false,
  };
  const queue = new SittingUploadQueue({
    transport: {
      postReadings: async () => undefined,
      postFinish: async () => ({
        sitting: {
          id: '3f2b8a52-6c1d-4e0a-9a53-0d7f5c2b9e11',
          patientNumber: 7,
          deviceId: '9d1c7e40-2b3a-4f5d-8e6f-1a2b3c4d5e6f',
          kind: 'check_in',
          source: 'simulated',
          startedAt: '2026-11-14T03:00:00.000Z',
          endedAt: '2026-11-14T03:01:00.000Z',
          clockOffsetMs: 0,
          summary: stored,
        },
      }),
    },
    isRetryable: () => false,
    describe: (error) => (error as Error).message,
  });
  queue.finish({ ...finishRequest, summary: { ...finishRequest.summary, heartRate: none } });
  await h.settle();
  assert.deepEqual(queue.getState().saved, stored);
  queue.dispose();
});
