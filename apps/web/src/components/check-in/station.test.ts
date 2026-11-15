import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CameraState, Sitting } from '@triagecam/contracts';

import { commandSettled, readyToStart, sittingToShow, stageCopy, stageOf } from './station.ts';

const idle: CameraState = { phase: 'idle', patientNumber: null, kind: null, sittingId: null, viewfinder: null, facePresent: false, exposureLocked: false, error: null };
const framing: CameraState = { ...idle, phase: 'framing', patientNumber: 14, kind: 'check_in', viewfinder: 'searching' };
const SITTING = '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c21';
const measuring: CameraState = { ...framing, phase: 'running', sittingId: SITTING, viewfinder: 'measuring', facePresent: true, exposureLocked: true };

const value = { value: 72, coverage: 0.8 };
const runningSitting: Sitting = {
  id: SITTING,
  patientNumber: 14,
  deviceId: '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c11',
  kind: 'check_in',
  source: 'simulated',
  startedAt: '2026-11-14T03:21:07.512Z',
  endedAt: null,
  clockOffsetMs: 0,
  summary: null,
};
const calledOff: Sitting = { ...runningSitting, endedAt: '2026-11-14T03:21:30.000Z' };
const finished: Sitting = {
  ...runningSitting,
  endedAt: '2026-11-14T03:22:07.512Z',
  summary: {
    durationSeconds: 60,
    heartRate: value,
    breathingRate: value,
    rmssd: value,
    sdnn: value,
    timeToFirstReadingSeconds: 11,
    longestDropoutSeconds: 0,
    frameCount: 3600,
    droppedFrames: 0,
    heartRateConfidence: 'normal',
  },
};

test('the stage follows the phone through a check-in', () => {
  const none = { cameraLive: false, sitting: null };
  assert.equal(stageOf({ ...none, camera: null }), 'offline');
  assert.equal(stageOf({ ...none, camera: idle }), 'ready');
  assert.equal(stageOf({ ...none, camera: { ...framing, phase: 'preparing' } }), 'opening');
  assert.equal(stageOf({ ...none, camera: { ...framing, phase: 'permission_denied' } }), 'blocked');
  assert.equal(stageOf({ ...none, camera: { ...framing, phase: 'unavailable' } }), 'blocked');
  assert.equal(stageOf({ camera: framing, cameraLive: true, sitting: null }), 'framing');
  assert.equal(stageOf({ camera: { ...framing, phase: 'starting' }, cameraLive: true, sitting: null }), 'starting');
  assert.equal(stageOf({ camera: measuring, cameraLive: true, sitting: runningSitting }), 'running');
  assert.equal(stageOf({ camera: { ...measuring, phase: 'stopping' }, cameraLive: true, sitting: runningSitting }), 'saving');
  assert.equal(stageOf({ camera: idle, cameraLive: false, sitting: finished }), 'done');
});

test('a phone back at idle before the summary arrives is saving, until that has taken too long', () => {
  assert.equal(stageOf({ camera: idle, cameraLive: false, sitting: runningSitting }), 'saving');
  assert.equal(stageOf({ camera: idle, cameraLive: false, sitting: runningSitting, summaryOverdue: true }), 'called_off');
  assert.equal(stageOf({ camera: idle, cameraLive: false, sitting: calledOff }), 'called_off');
});

test('a phone that stops reporting is lost mid-sitting, offline otherwise, and an older app is followed as before', () => {
  assert.equal(stageOf({ camera: null, cameraLive: false, sitting: runningSitting }), 'lost');
  assert.equal(stageOf({ camera: null, cameraLive: false, sitting: finished }), 'done');
  // Frames without state reports: an app from before remote control.
  assert.equal(stageOf({ camera: null, cameraLive: true, sitting: null }), 'manual');
  assert.equal(stageOf({ camera: null, cameraLive: true, sitting: runningSitting }), 'manual');
  // The same frames from a phone that was reporting a moment ago: it has gone quiet (QW-04).
  assert.equal(stageOf({ camera: null, cameraLive: true, sitting: runningSitting, reportedBefore: true }), 'lost');
  assert.equal(stageOf({ camera: null, cameraLive: true, sitting: null, reportedBefore: true }), 'offline');
});

test('the last sitting stays on screen until staff move on or the phone opens the next check-in', () => {
  assert.equal(sittingToShow(finished, idle, null), finished);
  assert.equal(sittingToShow(finished, null, null), finished);
  assert.equal(sittingToShow(finished, idle, finished.id), null);
  assert.equal(sittingToShow(finished, { ...framing, patientNumber: 15 }, null), null);
  assert.equal(sittingToShow(finished, { ...measuring, sittingId: '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c22' }, null), null);
  // The phone is still on its way out of the sitting that just finished.
  assert.equal(sittingToShow(finished, { ...measuring, phase: 'stopping' }, null), finished);
  assert.equal(sittingToShow(runningSitting, measuring, null), runningSitting);
  assert.equal(sittingToShow(null, measuring, null), null);
});

test('a command is settled by what the phone reports, not by the server taking it', () => {
  assert.equal(commandSettled({ type: 'open', patientNumber: 14 }, idle), false);
  assert.equal(commandSettled({ type: 'open', patientNumber: 14 }, { ...framing, phase: 'preparing', patientNumber: 15 }), false);
  assert.equal(commandSettled({ type: 'open', patientNumber: 14 }, { ...framing, phase: 'preparing' }), true);

  assert.equal(commandSettled({ type: 'start', patientNumber: null }, framing), false);
  assert.equal(commandSettled({ type: 'start', patientNumber: null }, { ...framing, phase: 'starting' }), true);
  // Refused on the phone: it stays framing and says why.
  assert.equal(commandSettled({ type: 'start', patientNumber: null }, { ...framing, error: 'Patient 14 has been discharged' }), true);

  assert.equal(commandSettled({ type: 'stop', patientNumber: null }, measuring), false);
  assert.equal(commandSettled({ type: 'stop', patientNumber: null }, { ...measuring, phase: 'stopping' }), true);
  assert.equal(commandSettled({ type: 'cancel', patientNumber: null }, measuring), false);
  assert.equal(commandSettled({ type: 'cancel', patientNumber: null }, idle), true);
});

test('Start waits for a face, and the words say what to do next', () => {
  assert.equal(readyToStart(null), false);
  assert.equal(readyToStart(framing), false);
  assert.equal(readyToStart({ ...framing, facePresent: true, viewfinder: 'locking' }), true);
  assert.equal(readyToStart(measuring), false);

  assert.equal(stageCopy('framing', framing, 'Front desk phone', null, 'check_in', false).title, 'Looking for a face');
  assert.equal(stageCopy('framing', { ...framing, facePresent: true }, 'Front desk phone', null, 'check_in', false).title, 'Face found');
  assert.equal(stageCopy('framing', { ...framing, facePresent: true, exposureLocked: true }, 'Front desk phone', null, 'check_in', false).title, 'Ready to start');
  assert.equal(stageCopy('running', { ...measuring, viewfinder: 'lost' }, 'Front desk phone', 'Simone Rivera', 'check_in', false).attention, true);
  assert.equal(stageCopy('done', idle, 'Front desk phone', 'Simone Rivera', 'check_in', false).detail, 'Baseline saved for Simone Rivera.');
  assert.equal(stageCopy('done', idle, 'Front desk phone', 'Simone Rivera', 'recheck', false).detail, 'Re-check saved for Simone Rivera.');
  assert.match(stageCopy('done', idle, 'Front desk phone', 'Simone Rivera', 'check_in', true).detail ?? '', /lower confidence/);
  assert.equal(stageCopy('called_off', idle, 'Front desk phone', 'Patient 43', 'check_in', false).detail, 'No readings were saved. Patient 43 is still in the waiting room.');
  // Ended at six seconds: finished, with nothing measured.
  const empty = stageCopy('done', idle, 'Front desk phone', 'Robert Okafor', 'recheck', false, true);
  assert.equal(empty.title, 'Sitting complete, no reading');
  assert.equal(empty.attention, true);
  assert.equal(stageCopy('offline', null, 'Front desk phone', null, null, false).title, 'Front desk phone is not connected');
});
