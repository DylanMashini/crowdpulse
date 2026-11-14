import assert from 'node:assert/strict';
import { test } from 'node:test';

import { forgetIntakeDraftIfUnchanged, forgetIntakeDrafts, keepIntakeDraft, readIntakeDraft } from './intake-draft.ts';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

test('unsaved intake text is kept per patient and forgotten once there is none', () => {
  const store = memory();
  keepIntakeDraft(77, { reasonForVisit: 'Dizzy since noon, fell in car park' }, store);
  keepIntakeDraft(78, { name: 'Maya Chen', painScore: null }, store);
  assert.deepEqual(readIntakeDraft(77, store), { reasonForVisit: 'Dizzy since noon, fell in car park' });
  assert.deepEqual(readIntakeDraft(78, store), { name: 'Maya Chen', painScore: null });
  assert.equal(readIntakeDraft(79, store), null);

  keepIntakeDraft(77, {}, store);
  assert.equal(readIntakeDraft(77, store), null);
  assert.equal(store.items.size, 1);
});

test('a draft is forgotten after a late save only if nothing was typed since', () => {
  const store = memory();
  keepIntakeDraft(77, { notes: 'On warfarin' }, store);
  forgetIntakeDraftIfUnchanged(77, { notes: 'On' }, store);
  assert.deepEqual(readIntakeDraft(77, store), { notes: 'On warfarin' });
  forgetIntakeDraftIfUnchanged(77, { notes: 'On warfarin' }, store);
  assert.equal(readIntakeDraft(77, store), null);
});

test('a deliberate sign-out forgets every draft and nothing else', () => {
  const store = memory({ other: 'kept' });
  keepIntakeDraft(77, { name: 'A' }, store);
  keepIntakeDraft(78, { name: 'B' }, store);
  forgetIntakeDrafts(store);
  assert.deepEqual([...store.items.keys()], ['other']);
});

test('no storage, and text that is not a draft, read as nothing kept', () => {
  assert.equal(readIntakeDraft(77, null), null);
  keepIntakeDraft(77, { name: 'A' }, null);
  forgetIntakeDrafts(null);
  const prefix = 'triagecam:intake-draft:';
  assert.equal(readIntakeDraft(1, memory({ [`${prefix}1`]: 'not json' })), null);
  assert.equal(readIntakeDraft(1, memory({ [`${prefix}1`]: '[1,2]' })), null);
  assert.equal(readIntakeDraft(1, memory({ [`${prefix}1`]: 'null' })), null);
  const refusing = { ...memory(), getItem: () => assert.fail('refused'), setItem: () => assert.fail('refused') };
  assert.equal(readIntakeDraft(1, refusing), null);
  keepIntakeDraft(1, { name: 'A' }, refusing);
});
