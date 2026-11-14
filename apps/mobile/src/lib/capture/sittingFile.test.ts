/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSittingFileShelf, FILE_UPLOAD_ATTEMPTS, handOffSittingFile, KEPT_FILES_LIMIT } from './sittingFile.ts';

function rig(failures: number) {
  const calls = { upload: 0, remove: 0, waits: [] as number[], warnings: [] as string[] };
  return {
    calls,
    upload: async () => {
      calls.upload += 1;
      if (calls.upload <= failures) throw new Error('offline');
    },
    remove: async () => {
      calls.remove += 1;
    },
    wait: async (ms: number) => {
      calls.waits.push(ms);
    },
    warn: (message: string) => {
      calls.warnings.push(message);
    },
  };
}

test('a file the server took is removed from the phone', async () => {
  const { calls, ...hooks } = rig(0);
  assert.equal(await handOffSittingFile({ wanted: true, ...hooks }), 'uploaded');
  assert.deepEqual([calls.upload, calls.remove], [1, 1]);
  assert.deepEqual(calls.warnings, []);
});

test('a failed upload is tried again before anything is removed', async () => {
  const { calls, ...hooks } = rig(2);
  assert.equal(await handOffSittingFile({ wanted: true, ...hooks }), 'uploaded');
  assert.deepEqual([calls.upload, calls.remove], [3, 1]);
  assert.equal(calls.waits.length, 2);
  assert.ok(calls.waits[1]! > calls.waits[0]!);
});

test('a file the server never took stays on the phone', async () => {
  const { calls, ...hooks } = rig(FILE_UPLOAD_ATTEMPTS);
  assert.equal(await handOffSittingFile({ wanted: true, ...hooks }), 'kept');
  assert.deepEqual([calls.upload, calls.remove], [FILE_UPLOAD_ATTEMPTS, 0]);
  assert.equal(calls.warnings.at(-1), 'The sitting file stays on the phone');
});

test('outside development the file is removed without being sent', async () => {
  const { calls, ...hooks } = rig(0);
  assert.equal(await handOffSittingFile({ wanted: false, ...hooks }), 'discarded');
  assert.deepEqual([calls.upload, calls.remove], [0, 1]);
});

test('a file that cannot be removed is a warning, not a failure', async () => {
  const { calls, ...hooks } = rig(0);
  const outcome = await handOffSittingFile({
    wanted: true,
    ...hooks,
    remove: async () => {
      throw new Error('gone');
    },
  });
  assert.equal(outcome, 'uploaded');
  assert.deepEqual(calls.warnings, ['The sitting file was not deleted']);
});

test('a file the server refuses for good is removed after one try', async () => {
  const { calls, ...hooks } = rig(FILE_UPLOAD_ATTEMPTS);
  const outcome = await handOffSittingFile({ wanted: true, ...hooks, permanent: () => true });
  assert.equal(outcome, 'refused');
  assert.deepEqual([calls.upload, calls.remove, calls.waits.length], [1, 1, 0]);
  assert.deepEqual(calls.warnings, ['The server will not take the sitting file']);
});

test('a failure that may pass is still tried three times', async () => {
  const { calls, ...hooks } = rig(FILE_UPLOAD_ATTEMPTS);
  assert.equal(await handOffSittingFile({ wanted: true, ...hooks, permanent: () => false }), 'kept');
  assert.deepEqual([calls.upload, calls.remove], [FILE_UPLOAD_ATTEMPTS, 0]);
});

/** A file whose upload fails while `online.value` is false. */
function shelved(online: { value: boolean }, log: string[], name: string) {
  return {
    wanted: true,
    upload: async () => {
      if (!online.value) throw new Error('offline');
      log.push(`sent ${name}`);
    },
    remove: async () => {
      log.push(`removed ${name}`);
    },
    wait: async () => {},
    warn: () => {},
  };
}

test('a kept file is offered again when the next one gets through', async () => {
  const online = { value: false };
  const log: string[] = [];
  const shelf = createSittingFileShelf();
  assert.equal(await shelf.handOff(shelved(online, log, 'a')), 'kept');
  assert.equal(shelf.keptCount, 1);
  assert.deepEqual(log, []);
  online.value = true;
  assert.equal(await shelf.handOff(shelved(online, log, 'b')), 'uploaded');
  assert.deepEqual(log, ['sent b', 'removed b', 'sent a', 'removed a']);
  assert.equal(shelf.keptCount, 0);
});

test('a kept file that fails again stays kept and is tried once, not three times', async () => {
  const log: string[] = [];
  const shelf = createSittingFileShelf();
  let tries = 0;
  const stubborn = {
    ...shelved({ value: false }, log, 'a'),
    upload: async () => {
      tries += 1;
      throw new Error('offline');
    },
  };
  await shelf.handOff(stubborn);
  assert.equal(tries, FILE_UPLOAD_ATTEMPTS);
  await shelf.handOff(shelved({ value: true }, log, 'b'));
  assert.equal(tries, FILE_UPLOAD_ATTEMPTS + 1);
  assert.equal(shelf.keptCount, 1);
  assert.deepEqual(log, ['sent b', 'removed b']);
});

test('a kept file the server then refuses for good is removed', async () => {
  const online = { value: false };
  const log: string[] = [];
  const shelf = createSittingFileShelf();
  const refusedLater = {
    ...shelved(online, log, 'a'),
    upload: async () => {
      throw new Error(online.value ? 'not found' : 'offline');
    },
    permanent: (failure: unknown) => (failure as Error).message === 'not found',
  };
  assert.equal(await shelf.handOff(refusedLater), 'kept');
  online.value = true;
  await shelf.handOff(shelved(online, log, 'b'));
  assert.deepEqual(log, ['sent b', 'removed b', 'removed a']);
  assert.equal(shelf.keptCount, 0);
});

test('no more than the limit is kept: the oldest file is removed', async () => {
  const online = { value: false };
  const log: string[] = [];
  const shelf = createSittingFileShelf();
  for (let index = 0; index <= KEPT_FILES_LIMIT; index += 1) {
    await shelf.handOff(shelved(online, log, String(index)));
  }
  assert.equal(shelf.keptCount, KEPT_FILES_LIMIT);
  assert.deepEqual(log, ['removed 0']);
});

test('files are handed off one at a time, in order', async () => {
  const online = { value: true };
  const log: string[] = [];
  const shelf = createSittingFileShelf();
  await Promise.all([shelf.handOff(shelved(online, log, 'a')), shelf.handOff(shelved(online, log, 'b'))]);
  assert.deepEqual(log, ['sent a', 'removed a', 'sent b', 'removed b']);
});
