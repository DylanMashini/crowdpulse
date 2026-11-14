/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError } from '../api/errors.ts';
import {
  createSittingFileShelf,
  FILE_UPLOAD_ATTEMPTS,
  handOffSittingFile,
  isPermanentRefusal,
  KEPT_FILES_LIMIT,
  type KeptFile,
  SittingFileGone,
} from './sittingFile.ts';

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

test('a failed file is one line in the log, whatever happened to it', async () => {
  // Three failed tries and "stays on the phone" used to be four warnings.
  const kept = rig(FILE_UPLOAD_ATTEMPTS);
  await handOffSittingFile({ wanted: true, ...kept });
  assert.deepEqual(kept.calls.warnings, ['The sitting file stays on the phone']);
  // Two failed tries and then success: nothing to say.
  const late = rig(2);
  await handOffSittingFile({ wanted: true, ...late });
  assert.deepEqual(late.calls.warnings, []);
  // Refused, and then not removable either: still one line.
  const refused = rig(FILE_UPLOAD_ATTEMPTS);
  await handOffSittingFile({
    wanted: true,
    ...refused,
    permanent: () => true,
    remove: async () => {
      throw new Error('gone');
    },
  });
  assert.deepEqual(refused.calls.warnings, ['The server will not take the sitting file']);
});

test('an expired session is not a refusal for good; a missing sitting or a missing file is', () => {
  const http = (status: number) => new ApiError('http', 'refused', { status });
  assert.equal(isPermanentRefusal(http(401)), false);
  assert.equal(isPermanentRefusal(http(404)), true);
  assert.equal(isPermanentRefusal(http(413)), true);
  assert.equal(isPermanentRefusal(http(403)), true);
  assert.equal(isPermanentRefusal(http(500)), false);
  assert.equal(isPermanentRefusal(http(429)), false);
  assert.equal(isPermanentRefusal(new ApiError('network', 'offline')), false);
  assert.equal(isPermanentRefusal(new SittingFileGone()), true);
  assert.equal(isPermanentRefusal(new Error('anything else')), false);
});

/** A store in memory, and the phone's files by name: what one run of the app leaves for the next. */
function phone(saved: KeptFile[] = []) {
  const state = { saved, saves: 0, online: false, log: [] as string[], warnings: [] as string[] };
  const record = (name: string): KeptFile => ({ sittingId: `sitting-${name}`, fileUri: `file:///caches/${name}.jsonl` });
  const name = (file: KeptFile) => file.sittingId.replace('sitting-', '');
  const open = (file: KeptFile) => shelved({ get value() { return state.online; } }, state.log, name(file));
  /** A new run of the app: nothing in memory, the same store. */
  const run = () =>
    createSittingFileShelf({
      store: {
        load: async () => state.saved,
        save: async (files) => {
          state.saved = files;
          state.saves += 1;
        },
      },
      open,
      warn: (message) => {
        state.warnings.push(message);
      },
    });
  return { state, record, open, run, names: () => state.saved.map(name) };
}

test('a kept file is written down, and the next run of the app offers it again', async () => {
  const { state, record, open, run, names } = phone();
  const first = run();
  assert.equal(await first.handOff(open(record('a')), record('a')), 'kept');
  assert.equal(await first.handOff(open(record('b')), record('b')), 'kept');
  assert.deepEqual(names(), ['a', 'b']);

  // The app is closed and opened; the server is still away. Both stay, with one line in the log.
  const second = run();
  assert.equal(second.keptCount, 0);
  assert.equal(await second.resume(), 2);
  assert.deepEqual(names(), ['a', 'b']);
  assert.deepEqual(state.log, []);
  assert.deepEqual(state.warnings, ['2 sitting files from earlier stay on the phone']);

  // Closed and opened again with the server back: both go, oldest first, and the list is empty.
  state.online = true;
  state.warnings = [];
  const third = run();
  assert.equal(await third.resume(), 0);
  assert.deepEqual(state.log, ['sent a', 'removed a', 'sent b', 'removed b']);
  assert.deepEqual(names(), []);
  assert.deepEqual(state.warnings, []);
  // Asking twice in one run does nothing more.
  assert.equal(await third.resume(), 0);
  assert.deepEqual(state.log, ['sent a', 'removed a', 'sent b', 'removed b']);
});

test('files from earlier runs count towards the limit: never more than five kept, oldest removed first', async () => {
  // Seven written down by earlier runs (a list from a build without the limit, or edited by hand).
  const { state, record, open, run, names } = phone();
  state.saved = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(record);
  const shelf = run();
  assert.equal(await shelf.resume(), KEPT_FILES_LIMIT);
  assert.deepEqual(state.log, ['removed a', 'removed b']);
  assert.deepEqual(names(), ['c', 'd', 'e', 'f', 'g']);

  // One more that does not get through in this run: the oldest of the earlier ones goes.
  assert.equal(await shelf.handOff(open(record('h')), record('h')), 'kept');
  assert.equal(shelf.keptCount, KEPT_FILES_LIMIT);
  assert.deepEqual(state.log, ['removed a', 'removed b', 'removed c']);
  assert.deepEqual(names(), ['d', 'e', 'f', 'g', 'h']);

  // The server comes back: the new file gets through, then the kept ones, oldest first.
  state.online = true;
  assert.equal(await shelf.handOff(open(record('i')), record('i')), 'uploaded');
  assert.equal(shelf.keptCount, 0);
  assert.deepEqual(names(), []);
  assert.deepEqual(state.log.slice(3), ['sent i', 'removed i', 'sent d', 'removed d', 'sent e', 'removed e', 'sent f', 'removed f', 'sent g', 'removed g', 'sent h', 'removed h']);
});

test('a file being uploaded when the app is closed is found by the next run', async () => {
  const { state, record, run, names } = phone();
  const shelf = run();
  let release = () => {};
  const uploading = shelf.handOff(
    {
      wanted: true,
      upload: () => new Promise<void>((resolve) => (release = resolve)),
      remove: async () => {
        state.log.push('removed a');
      },
      warn: () => {},
    },
    record('a'),
  );
  // Let the hand-off reach the upload: the file is written down before the first byte is sent.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(names(), ['a']);
  release();
  assert.equal(await uploading, 'uploaded');
  assert.deepEqual(names(), []);
});

test('a file from an earlier run that is gone from the phone is forgotten, not kept for ever', async () => {
  const { state, record, names } = phone();
  state.saved = [record('a'), record('b')];
  const shelf = createSittingFileShelf({
    store: {
      load: async () => state.saved,
      save: async (files) => {
        state.saved = files;
      },
    },
    open: (file) => ({
      wanted: true,
      upload: async () => {
        if (file.sittingId === 'sitting-a') throw new SittingFileGone();
        state.log.push('sent b');
      },
      remove: async () => {
        if (file.sittingId === 'sitting-a') throw new Error('Not a sitting file');
        state.log.push('removed b');
      },
      permanent: isPermanentRefusal,
    }),
    warn: (message) => {
      state.warnings.push(message);
    },
  });
  assert.equal(await shelf.resume(), 0);
  assert.deepEqual(state.log, ['sent b', 'removed b']);
  assert.deepEqual(names(), []);
  assert.deepEqual(state.warnings, []);
});

test('a store that fails does not stop a hand-off', async () => {
  const warnings: string[] = [];
  const log: string[] = [];
  const shelf = createSittingFileShelf({
    store: {
      load: async () => {
        throw new Error('keychain locked');
      },
      save: async () => {
        throw new Error('keychain locked');
      },
    },
    open: () => shelved({ value: true }, log, 'x'),
    warn: (message) => {
      warnings.push(message);
    },
  });
  assert.equal(await shelf.resume(), 0);
  const file = { sittingId: 'sitting-a', fileUri: 'file:///caches/a.jsonl' };
  assert.equal(await shelf.handOff(shelved({ value: true }, log, 'a'), file), 'uploaded');
  assert.deepEqual(log, ['sent a', 'removed a']);
  assert.ok(warnings.includes('The list of kept sitting files was not read'));
  assert.ok(warnings.includes('The list of kept sitting files was not saved'));
});
