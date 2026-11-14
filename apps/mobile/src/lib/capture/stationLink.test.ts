/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CameraCommand, CameraState, LiveRegions, PostLiveStateRequest, PostLiveStateResponse } from '@triagecam/contracts';

import { IDLE_STATE, StationLink } from './stationLink.ts';

const DEVICE = '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c11';
const framing: CameraState = { ...IDLE_STATE, phase: 'framing', patientNumber: 14, kind: 'check_in', viewfinder: 'locking', facePresent: true };
const square = [
  { x: 0.4, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.3 },
  { x: 0.4, y: 0.3 },
];
const regions = (x: number): LiveRegions => ({
  aspectRatio: 16 / 9,
  face: { x, y: 0.15, width: 0.3, height: 0.5 },
  forehead: square,
  leftCheek: square,
  rightCheek: square,
  chest: null,
});
const command = (id: string, type: CameraCommand['type'] = 'start'): CameraCommand => ({ id, type, patientNumber: null, kind: null, enrolFace: false });

/** A server whose answers are released by the test, and a clock the test ticks. */
function rig() {
  const reports: PostLiveStateRequest[] = [];
  const waiting: { resolve: (answer: PostLiveStateResponse) => void; reject: (error: Error) => void }[] = [];
  let tick: (() => void) | null = null;
  const link = new StationLink(
    (_deviceId, report) => {
      reports.push(report);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    {
      setInterval: (run) => {
        tick = run;
        return 1;
      },
      clearInterval: () => {
        tick = null;
      },
    },
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    link,
    reports,
    tick: () => tick?.(),
    ticking: () => tick !== null,
    answer: async (next: CameraCommand | null = null) => {
      waiting.shift()?.resolve({ viewers: 1, command: next });
      await settle();
    },
    fail: async () => {
      waiting.shift()?.reject(new Error('offline'));
      await settle();
    },
  };
}

test('nothing is reported until the link is connected, then at once and once a second', async () => {
  const { link, reports, tick, answer } = rig();
  link.setState(framing);
  assert.equal(reports.length, 0);

  link.connect(DEVICE);
  assert.deepEqual(reports, [{ state: framing, regions: null }]);
  await answer();
  tick();
  assert.equal(reports.length, 2);
});

test('one report is in flight at most, and what changed meanwhile goes out newest only', async () => {
  const { link, reports, answer } = rig();
  link.connect(DEVICE);
  link.setState(framing);
  link.setRegions(regions(0.31));
  link.setRegions(regions(0.32));
  link.setRegions(regions(0.33));
  assert.equal(reports.length, 1, 'the first report has not been answered');

  await answer();
  assert.equal(reports.length, 2);
  assert.equal(reports[1]?.state.phase, 'framing');
  assert.equal(reports[1]?.regions?.face?.x, 0.33);

  await answer();
  assert.equal(reports.length, 2, 'nothing changed, so nothing more is sent');
});

test('a state that says the same thing again is not sent again, and going idle drops the outlines', async () => {
  const { link, reports, answer } = rig();
  link.connect(DEVICE);
  await answer();
  link.setState({ ...IDLE_STATE });
  assert.equal(reports.length, 1);

  link.setState(framing);
  await answer();
  link.setRegions(regions(0.3));
  await answer();
  link.setState(IDLE_STATE);
  assert.deepEqual(reports.at(-1), { state: IDLE_STATE, regions: null });
});

test('a command reaches every handler once, whatever the server repeats', async () => {
  const { link, tick, answer } = rig();
  const got: string[] = [];
  link.onCommand((next) => got.push(`a:${next.type}`));
  const stop = link.onCommand((next) => got.push(`b:${next.type}`));
  link.connect(DEVICE);
  await answer(command('6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c01'));
  assert.deepEqual(got, ['a:start', 'b:start']);

  tick();
  await answer(command('6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c01'));
  assert.equal(got.length, 2, 'the same id is not carried out twice');

  stop();
  tick();
  await answer(command('6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c02', 'cancel'));
  assert.deepEqual(got.slice(2), ['a:cancel']);
});

test('a report that fails is dropped and the next one still goes out', async () => {
  const { link, reports, tick, fail, answer } = rig();
  link.connect(DEVICE);
  await fail();
  tick();
  assert.equal(reports.length, 2);
  await answer();
});

test('disconnecting stops the reports, and an answer that arrives afterwards is ignored', async () => {
  const { link, reports, tick, ticking, answer } = rig();
  const got: CameraCommand[] = [];
  link.onCommand((next) => got.push(next));
  link.connect(DEVICE);
  link.disconnect();
  assert.equal(ticking(), false);
  await answer(command('6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c03'));
  assert.equal(got.length, 0);
  tick();
  link.setState(framing);
  assert.equal(reports.length, 1);
});
