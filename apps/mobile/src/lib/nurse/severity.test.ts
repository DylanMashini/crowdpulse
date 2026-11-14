import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertSeverity, patientSeverity, ruleSeverity } from './severity.ts';

const flag = (rule: 'score_rise' | 'baseline_shift' | 'overdue', closedAt: string | null = null) => ({ rule, closedAt });

test('a flag takes its severity from the rules it tripped', () => {
  assert.equal(ruleSeverity(['baseline_shift']), 'watch');
  assert.equal(ruleSeverity(['baseline_shift', 'score_rise']), 'urgent');
  assert.equal(ruleSeverity(['overdue']), 'overdue');
  assert.equal(alertSeverity({ flags: [flag('score_rise')] }), 'urgent');
});

test('a patient is drawn by the state the server gave, never ahead of it', () => {
  assert.equal(patientSeverity({ state: 'observed', score: 3, flags: [] }), 'stable');
  assert.equal(patientSeverity({ state: 'no-reading', score: null, flags: [] }), 'none');
  assert.equal(patientSeverity({ state: 'overdue', score: 1, flags: [flag('overdue')] }), 'overdue');
});

test('a flagged patient is urgent on a rising score or a score of 3, and watch otherwise', () => {
  assert.equal(patientSeverity({ state: 'flag', score: 1, flags: [flag('baseline_shift')] }), 'watch');
  assert.equal(patientSeverity({ state: 'flag', score: 2, flags: [flag('baseline_shift'), flag('score_rise')] }), 'urgent');
  assert.equal(patientSeverity({ state: 'flag', score: 3, flags: [flag('baseline_shift')] }), 'urgent');
  // A score rise that has closed no longer colours the patient.
  assert.equal(patientSeverity({ state: 'flag', score: 1, flags: [flag('score_rise', '2026-11-14T03:00:00Z'), flag('baseline_shift')] }), 'watch');
  assert.equal(patientSeverity({ state: 'flag' }), 'watch');
});
