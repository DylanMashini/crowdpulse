import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SESSION_ENDED, SESSION_ENDED_UNSAVED, sessionEndedText } from './session-ended.ts';

test('sign-in says why staff were sent there, and only for a reason it knows', () => {
  assert.equal(sessionEndedText(SESSION_ENDED), 'Your session ended. Sign in to carry on where you left off.');
  assert.equal(
    sessionEndedText(SESSION_ENDED_UNSAVED),
    'Your session ended before your last action went through. Sign in, then do it again.',
  );
  // A plain visit, a deliberate sign-out, and a made-up value in the address bar say nothing.
  assert.equal(sessionEndedText(undefined), null);
  assert.equal(sessionEndedText(''), null);
  assert.equal(sessionEndedText('<b>You have been hacked</b>'), null);
});
