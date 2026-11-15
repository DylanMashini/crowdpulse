import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPartParser, type FeedFrame } from './live-feed.ts';

const encoder = new TextEncoder();
const JPEG = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

function part(headers: Record<string, string>): Uint8Array {
  const head = encoder.encode(
    `Content-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n` +
      Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('') +
      '\r\n',
  );
  const tail = encoder.encode('\r\n--frame\r\n');
  const bytes = new Uint8Array(head.length + JPEG.length + tail.length);
  bytes.set(head, 0);
  bytes.set(JPEG, head.length);
  bytes.set(tail, head.length + JPEG.length);
  return bytes;
}

const square = [
  { x: 0.4, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.3 },
  { x: 0.4, y: 0.3 },
];
const regions = { aspectRatio: 1.3333, face: { x: 0.35, y: 0.15, width: 0.3, height: 0.5 }, forehead: square, leftCheek: square, rightCheek: square, chest: null };

test('a part is cut out whole however the bytes arrive, with the outlines that came on it', () => {
  const frames: FeedFrame[] = [];
  const parse = createPartParser((frame) => frames.push(frame));
  const first = part({ 'x-frame-received-at': '1700000000000', 'x-frame-sequence': '7', 'x-frame-regions': JSON.stringify(regions) });
  const second = part({ 'x-frame-sequence': '8' });
  const stream = new Uint8Array(first.length + second.length);
  stream.set(first, 0);
  stream.set(second, first.length);

  // Three bytes at a time: a header, a picture and a boundary are all split somewhere.
  for (let offset = 0; offset < stream.length; offset += 3) parse(stream.subarray(offset, offset + 3));

  assert.equal(frames.length, 2);
  assert.deepEqual([...(frames[0]?.jpeg ?? [])], [...JPEG]);
  assert.equal(frames[0]?.sequence, 7);
  assert.equal(frames[0]?.receivedAt, 1700000000000);
  assert.deepEqual(frames[0]?.regions, regions);
  // A picture with no outlines header clears them.
  assert.equal(frames[1]?.regions, null);
});

test('outlines this page cannot read are no outlines, and the picture is still shown', () => {
  const frames: FeedFrame[] = [];
  const parse = createPartParser((frame) => frames.push(frame));
  parse(part({ 'x-frame-regions': '{"aspectRatio":' }));
  parse(part({ 'x-frame-regions': JSON.stringify({ ...regions, forehead: [{ x: 0.1, y: 0.2 }] }) }));
  assert.deepEqual(
    frames.map((frame) => frame.regions),
    [null, null],
  );
  assert.equal(frames[1]?.jpeg.length, JPEG.length);
});
