/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FILE_UPLOAD_ATTEMPTS, handOffSittingFile } from './sittingFile.ts';

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
