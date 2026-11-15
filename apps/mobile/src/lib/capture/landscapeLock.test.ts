/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createLandscapeLock } from './landscapeLock.ts';

function rig() {
  const calls: boolean[] = [];
  return { calls, lock: createLandscapeLock((locked) => calls.push(locked)) };
}

test('the interface turns to landscape when the sitting screen has arrived, not before', () => {
  const { calls, lock } = rig();
  // The check-in list at launch.
  lock.transitionEnded({ screen: 'index', closing: false });
  assert.deepEqual(calls, []);
  // A sitting is pushed: the list finishes leaving, then the sitting screen finishes arriving.
  lock.transitionEnded({ screen: 'index', closing: true });
  assert.deepEqual(calls, [], 'a screen that has left decides nothing');
  lock.transitionEnded({ screen: 'sitting', closing: false });
  assert.deepEqual(calls, [true]);
});

test('it turns back only when the screen after the sitting has arrived', () => {
  const { calls, lock } = rig();
  lock.transitionEnded({ screen: 'sitting', closing: false });
  // Called off: the sitting screen is on its way out. Turning now is what broke the next sitting.
  lock.transitionEnded({ screen: 'sitting', closing: true });
  assert.deepEqual(calls, [true]);
  lock.transitionEnded({ screen: 'index', closing: false });
  assert.deepEqual(calls, [true, false]);
  // Finished: the summary takes the sitting's place.
  lock.transitionEnded({ screen: 'sitting', closing: false });
  lock.transitionEnded({ screen: 'summary', closing: false });
  assert.deepEqual(calls, [true, false, true, false]);
});

test('one sitting screen replacing another keeps the lock, and it is set once', () => {
  const { calls, lock } = rig();
  lock.transitionEnded({ screen: 'sitting', closing: false });
  lock.transitionEnded({ screen: 'sitting', closing: true });
  lock.transitionEnded({ screen: 'sitting', closing: false });
  assert.deepEqual(calls, [true]);
  lock.release();
  lock.release();
  assert.deepEqual(calls, [true, false]);
});

test('no screen of the camera role turns the interface from its own mount or unmount (BUG-14)', () => {
  // The defect was exactly this call in the sitting screen's effect. The lock belongs to the
  // navigator's transition events, in the camera layout, and nowhere else.
  const read = (name: string) => readFileSync(new URL(`../../app/camera/${name}`, import.meta.url), 'utf8');
  for (const screen of ['index.tsx', 'match.tsx', 'sitting.tsx', 'summary.tsx']) {
    assert.equal(read(screen).includes('setLandscapeLock'), false, `${screen} changes the landscape lock itself`);
  }
  assert.equal(read('_layout.tsx').includes('transitionEnd'), true, 'the camera layout does not follow the transitions');
});
