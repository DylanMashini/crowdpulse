import assert from 'node:assert/strict';
import { test } from 'node:test';

import { severityOf } from './severity.ts';

test('a rising score or a score of 3 is urgent', () => {
  assert.equal(severityOf('flag', 2, ['score_rise']), 'urgent');
  assert.equal(severityOf('flag', 1, ['score_rise', 'baseline_shift']), 'urgent');
  assert.equal(severityOf('observed', 3), 'urgent');
  assert.equal(severityOf('overdue', 3, ['overdue']), 'urgent');
});

test('a move from the baseline is watch', () => {
  assert.equal(severityOf('flag', 1, ['baseline_shift']), 'watch');
  assert.equal(severityOf('flag', 0, []), 'watch');
});

test('observed, overdue and no-reading carry no severity colour below a score of 3', () => {
  assert.equal(severityOf('observed', 2), null);
  assert.equal(severityOf('overdue', 1, ['overdue']), null);
  assert.equal(severityOf('no-reading', null), null);
  assert.equal(severityOf(null, null), null);
});
