import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type SseMessage, createSseParser } from './sse.ts';

function collect() {
  const messages: SseMessage[] = [];
  let comments = 0;
  const feed = createSseParser(
    (message) => messages.push(message),
    () => (comments += 1),
  );
  return { messages, feed, comments: () => comments };
}

test('one event with its type and data', () => {
  const { messages, feed } = collect();
  feed('event: worklist_changed\ndata: {"type":"worklist_changed","at":"2026-11-14T03:21:07.512Z"}\n\n');
  assert.deepEqual(messages, [
    { event: 'worklist_changed', data: '{"type":"worklist_changed","at":"2026-11-14T03:21:07.512Z"}' },
  ]);
});

test('an event cut anywhere by the network arrives whole, once', () => {
  const whole = 'event: flag_opened\ndata: {"a":1}\n\nevent: flag_closed\ndata: {"b":2}\n\n';
  for (let cut = 1; cut < whole.length; cut += 1) {
    const { messages, feed } = collect();
    feed(whole.slice(0, cut));
    feed(whole.slice(cut));
    assert.deepEqual(messages, [
      { event: 'flag_opened', data: '{"a":1}' },
      { event: 'flag_closed', data: '{"b":2}' },
    ]);
  }
});

test('pings are comments: they are counted and never become an event', () => {
  const { messages, feed, comments } = collect();
  feed(': ping\n\n: ping\n\n');
  assert.deepEqual(messages, []);
  assert.equal(comments(), 2);
});

test('carriage returns, several data lines and a missing event name', () => {
  const { messages, feed } = collect();
  feed('data: one\r\ndata: two\r\n\r\n');
  assert.deepEqual(messages, [{ event: 'message', data: 'one\ntwo' }]);
});

test('the event name does not leak into the next event', () => {
  const { messages, feed } = collect();
  feed('event: reading\ndata: 1\n\ndata: 2\n\n');
  assert.deepEqual(messages, [
    { event: 'reading', data: '1' },
    { event: 'message', data: '2' },
  ]);
});

test('nothing is sent until the blank line that ends the event', () => {
  const { messages, feed } = collect();
  feed('event: reading\ndata: 1\n');
  assert.deepEqual(messages, []);
  feed('\n');
  assert.equal(messages.length, 1);
});
