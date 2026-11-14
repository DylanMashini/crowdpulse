/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Flag, Patient, Sitting } from '@triagecam/contracts';

import {
  ageInYears,
  calendarDate,
  connectionText,
  demographics,
  filterPatients,
  flagAcknowledgedText,
  alertsToAcknowledge,
  announcements,
  flagGroups,
  flagOpenedText,
  flagRuleLabel,
  intakeRows,
  minutesSince,
  patientCountsText,
  sittingRows,
  toAcknowledgeText,
  vitalSeries,
  withAcknowledgement,
  followAlerts,
} from './nurseFormat.ts';

const NOW = new Date(2026, 10, 14, 14, 30, 0).getTime();
const at = (hours: number, minutes: number, day = 14) => new Date(2026, 10, day, hours, minutes, 0).toISOString();

function patient(overrides: Partial<Patient>): Patient {
  return {
    number: 1,
    name: null,
    dateOfBirth: null,
    sex: null,
    reasonForVisit: null,
    painScore: null,
    allergies: null,
    notes: null,
    status: 'waiting',
    createdAt: at(13, 0),
    dischargedAt: null,
    intakeCompletedAt: null,
    photoUpdatedAt: null,
    faceOptIn: false,
    faceEnrolled: false,
    ...overrides,
  };
}

function flag(overrides: Partial<Flag>): Flag {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    patientNumber: 1,
    patient: { number: 1, name: 'Maya Chen', photoUpdatedAt: null },
    rule: 'baseline_shift',
    openedAt: at(14, 0),
    closedAt: null,
    detail: {
      pulse: { base: 82, now: 108 },
      breathing: { base: 16, now: 24 },
      scoreAtCheckIn: 0,
      scoreNow: 2,
      minutesSinceCheckIn: 26,
      minutesSinceObserved: null,
    },
    acknowledgedAt: null,
    acknowledgedBy: null,
    handoff: 'Maya Chen: pulse 82 at check-in, 108 now.',
    // An alert on its own unless the test says which alert it belongs to.
    alertId: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

function sitting(id: string, endedAt: string | null, heartRate: number | null, breathingRate: number | null): Sitting {
  return {
    id,
    patientNumber: 1,
    deviceId: '00000000-0000-4000-8000-0000000000d1',
    kind: id === 'a' ? 'check_in' : 'recheck',
    source: 'simulated',
    startedAt: at(13, 0),
    endedAt,
    clockOffsetMs: 0,
    summary: endedAt
      ? {
          durationSeconds: 59.6,
          heartRate: { value: heartRate, coverage: heartRate == null ? 0 : 0.83 },
          breathingRate: { value: breathingRate, coverage: breathingRate == null ? 0 : 0.4 },
          rmssd: { value: null, coverage: 0 },
          sdnn: { value: null, coverage: 0 },
          timeToFirstReadingSeconds: heartRate == null ? null : 11,
          longestDropoutSeconds: 0,
          frameCount: 3600,
          droppedFrames: 0,
        }
      : null,
  };
}

test('minutes since a time are whole and never negative', () => {
  assert.equal(minutesSince(at(14, 18), NOW), 12);
  assert.equal(minutesSince(at(14, 29), NOW), 1);
  assert.equal(minutesSince(at(14, 45), NOW), 0);
  assert.equal(minutesSince(null, NOW), null);
  assert.equal(minutesSince('not a time', NOW), null);
});

test('age counts whole years and waits for the birthday', () => {
  assert.equal(ageInYears('1991-04-18', NOW), 35);
  assert.equal(ageInYears('1991-11-14', NOW), 35);
  assert.equal(ageInYears('1991-11-15', NOW), 34);
  assert.equal(ageInYears(null, NOW), null);
  assert.equal(ageInYears('18/04/1991', NOW), null);
  assert.equal(ageInYears('2030-01-01', NOW), null);
});

test('a calendar date is printed without a time zone shifting it', () => {
  assert.equal(calendarDate('1991-04-18'), '18 Apr 1991');
  assert.equal(calendarDate('2001-01-01'), '1 Jan 2001');
});

test('demographics give what is known and nothing else', () => {
  assert.equal(demographics({ dateOfBirth: '1991-04-18', sex: 'female' }, NOW), '35 y, female');
  assert.equal(demographics({ dateOfBirth: null, sex: 'male' }, NOW), 'male');
  assert.equal(demographics({ dateOfBirth: '1958-02-02', sex: null }, NOW), '68 y');
  assert.equal(demographics({ dateOfBirth: null, sex: null }, NOW), null);
});

test('intake rows list only what staff entered, pain with its scale', () => {
  assert.deepEqual(intakeRows(patient({}), NOW), []);
  assert.deepEqual(
    intakeRows(
      patient({ reasonForVisit: 'Twisted ankle', painScore: 0, allergies: 'Penicillin', dateOfBirth: '1991-04-18', sex: 'female' }),
      NOW,
    ),
    [
      { label: 'Reason for visit', value: 'Twisted ankle' },
      { label: 'Pain, as reported', value: '0 of 10' },
      { label: 'Allergies', value: 'Penicillin' },
      { label: 'Date of birth', value: '18 Apr 1991 (35 y)' },
      { label: 'Sex', value: 'Female' },
    ],
  );
});

test('unacknowledged flags lead; trend before overdue; longest open first; closed left out', () => {
  const flags = [
    flag({ id: 'overdue-new', rule: 'overdue', openedAt: at(14, 20) }),
    flag({ id: 'trend-new', openedAt: at(14, 10) }),
    flag({ id: 'trend-old', rule: 'score_rise', openedAt: at(13, 50) }),
    flag({ id: 'acked', openedAt: at(13, 40), acknowledgedAt: at(13, 45), acknowledgedBy: 'nurse@ward.test' }),
    flag({ id: 'closed', closedAt: at(14, 0) }),
  ];
  const groups = flagGroups(flags);
  assert.deepEqual(
    groups.unacknowledged.map((item) => item.id),
    ['trend-old', 'trend-new', 'overdue-new'],
  );
  assert.deepEqual(
    groups.acknowledged.map((item) => item.id),
    ['acked'],
  );
});

// One deterioration as the server sends it: both trend rules tripped on one sitting, so two
// flags with one alert id, the same opening time and the same sentence.
const deterioration = (alertId = 'trend-1-a', openedAt = at(14, 10)): [Flag, Flag] => [
  flag({ id: `${alertId}/rise`, rule: 'score_rise', alertId, openedAt }),
  flag({ id: `${alertId}/shift`, rule: 'baseline_shift', alertId, openedAt }),
];

test('one deterioration is one alert to acknowledge, on the tab, the badge and the worklist card', () => {
  const [rise, shift] = deterioration();
  const groups = flagGroups([rise, shift]);
  assert.equal(groups.unacknowledged.length, 1);
  assert.deepEqual(groups.unacknowledged[0]?.flags, [rise, shift]);
  assert.deepEqual(groups.acknowledged, []);
  assert.equal(alertsToAcknowledge([rise, shift]), 1);
  assert.equal(toAcknowledgeText([rise, shift]), '1 flag to acknowledge');

  // An overdue flag, and a trend flag raised by a later sitting, are alerts of their own.
  const overdue = flag({ id: 'overdue', rule: 'overdue', openedAt: at(14, 20) });
  const [later] = deterioration('trend-1-b', at(14, 25));
  assert.equal(alertsToAcknowledge([rise, shift, overdue, later]), 3);
  assert.equal(toAcknowledgeText([rise, shift, overdue]), '2 flags to acknowledge');
  assert.equal(toAcknowledgeText([]), null);

  // Acknowledged, it leaves the count and moves to the acknowledged group as one card.
  const by = { acknowledgedAt: at(14, 12), acknowledgedBy: 'nurse@ward.test' };
  const acknowledged = flagGroups([{ ...rise, ...by }, { ...shift, ...by }]);
  assert.equal(acknowledged.unacknowledged.length, 0);
  assert.equal(acknowledged.acknowledged.length, 1);
  assert.equal(toAcknowledgeText([{ ...rise, ...by }, { ...shift, ...by }]), null);
});

test('one deterioration is announced once, however its flags arrive', () => {
  const [rise, shift] = deterioration();
  const launch = announcements([], new Set());

  // Both flags in one refresh: one banner.
  const together = announcements([rise, shift], launch.seen);
  assert.equal(together.alerts.length, 1);
  assert.deepEqual(together.alerts[0]?.flags, [rise, shift]);
  assert.deepEqual(announcements([rise, shift], together.seen).alerts, []);

  // The second flag a refresh after the first: still one banner, which then holds both flags.
  const first = announcements([rise], launch.seen);
  assert.equal(first.alerts.length, 1);
  const second = announcements([rise, shift], first.seen);
  assert.deepEqual(second.alerts, []);
  assert.deepEqual(followAlerts(first.alerts, [rise, shift])[0]?.flags, [rise, shift]);

  // Opened from a tapped push, which names one of the two flags: no banner for either.
  assert.deepEqual(announcements([rise, shift], new Set([shift.id])).alerts, []);

  // Open when the app launched, or already acknowledged by someone: not news.
  const atLaunch = announcements([rise, shift], new Set());
  assert.deepEqual(announcements([rise, shift], atLaunch.seen).alerts, []);
  const by = { acknowledgedAt: at(14, 12), acknowledgedBy: 'nurse@ward.test' };
  assert.deepEqual(announcements([{ ...rise, ...by }, { ...shift, ...by }], launch.seen).alerts, []);

  // A later deterioration of the same patient, and an overdue flag, are announced: three in all.
  const [laterRise] = deterioration('trend-1-b', at(14, 25));
  const overdue = flag({ id: 'overdue', rule: 'overdue', openedAt: at(14, 20) });
  const more = announcements([rise, shift, laterRise, overdue], together.seen);
  assert.deepEqual(more.alerts.map((alert) => alert.id), ['trend-1-b', 'overdue']);
});

test('acknowledging covers the whole alert and nothing else, and leaves one acknowledged banner', () => {
  const [rise, shift] = deterioration();
  const [otherRise] = deterioration('trend-1-b', at(14, 25));
  const overdue = flag({ id: 'overdue', rule: 'overdue', openedAt: at(14, 20) });
  const elsewhere = flag({ id: 'other-patient', patientNumber: 2, alertId: 'trend-2-a' });
  const closed = flag({ id: 'closed', alertId: rise.alertId, closedAt: at(14, 11) });
  const open = [rise, shift, otherRise, overdue, elsewhere, closed];
  const banners = announcements([rise, shift], new Set()).alerts;

  // The server answers with the one flag that was pressed.
  const answer = { ...rise, acknowledgedAt: at(14, 12), acknowledgedBy: 'nurse@ward.test' };
  const after = withAcknowledgement(open, answer);
  assert.deepEqual(
    after.map((each) => [each.id, each.acknowledgedAt]),
    [
      [rise.id, at(14, 12)],
      [shift.id, at(14, 12)],
      [otherRise.id, null],
      [overdue.id, null],
      [elsewhere.id, null],
      [closed.id, null],
    ],
  );
  assert.equal(after[1]?.acknowledgedBy, 'nurse@ward.test');

  // The banner now says acknowledged, and there is no second one queued behind it.
  const showing = followAlerts(banners, after);
  assert.equal(showing.length, 1);
  assert.equal(showing[0]?.acknowledgedAt, at(14, 12));
  assert.deepEqual(showing[0]?.waiting, []);
  assert.equal(alertsToAcknowledge(after), 3);

  // An acknowledgement someone made earlier is kept, not overwritten.
  const earlier = { ...shift, acknowledgedAt: at(14, 11), acknowledgedBy: 'first@ward.test' };
  assert.equal(withAcknowledgement([rise, earlier], answer)[1]?.acknowledgedBy, 'first@ward.test');

  // A banner follows its alert: closed, it goes away.
  assert.deepEqual(followAlerts(banners, [overdue]), []);
});

test('a flag says when it opened and who acknowledged it', () => {
  assert.equal(flagOpenedText({ openedAt: at(14, 18) }, NOW), 'Opened 14:18, 12 min ago');
  assert.equal(flagOpenedText({ openedAt: at(14, 30) }, NOW), 'Opened 14:30, just now');
  assert.equal(flagOpenedText({ openedAt: at(12, 0) }, NOW), 'Opened 12:00');
  assert.equal(flagOpenedText({ openedAt: at(22, 5, 13) }, NOW), 'Opened 13 Nov, 22:05');
  assert.equal(
    flagAcknowledgedText({ acknowledgedAt: at(14, 20), acknowledgedBy: 'nurse@ward.test' }, NOW),
    'Acknowledged 14:20 by nurse@ward.test',
  );
  assert.equal(flagAcknowledgedText({ acknowledgedAt: null, acknowledgedBy: null }, NOW), '');
});

test('each rule has its own badge words', () => {
  assert.equal(flagRuleLabel('score_rise'), 'Score above check-in');
  assert.equal(flagRuleLabel('baseline_shift'), 'Change from check-in');
  assert.equal(flagRuleLabel('overdue'), 'Re-check overdue');
});

test('the patient list filters by status, name, reason and visit number', () => {
  const patients = [
    patient({ number: 1, name: 'Maya Chen', reasonForVisit: 'Twisted ankle on the stairs' }),
    patient({ number: 12, name: 'Robert Okafor', reasonForVisit: 'Short of breath' }),
    patient({ number: 6, name: 'Elena Sokolova', status: 'discharged', reasonForVisit: 'Ankle sprain' }),
    patient({ number: 5 }),
  ];
  const numbers = (found: Patient[]) => found.map((item) => item.number);
  assert.deepEqual(numbers(filterPatients(patients, 'waiting', '')), [1, 12, 5]);
  assert.deepEqual(numbers(filterPatients(patients, 'discharged', '')), [6]);
  assert.deepEqual(numbers(filterPatients(patients, 'all', 'ankle')), [1, 6]);
  assert.deepEqual(numbers(filterPatients(patients, 'all', '  MAYA  chen ')), [1]);
  assert.deepEqual(numbers(filterPatients(patients, 'all', '1')), [1, 12]);
  assert.deepEqual(numbers(filterPatients(patients, 'all', 'No. 12')), [12]);
  assert.deepEqual(numbers(filterPatients(patients, 'all', '5')), [5]);
  assert.deepEqual(numbers(filterPatients(patients, 'waiting', 'sokolova')), []);
});

test('the patient counts print only what is known in full', () => {
  assert.equal(patientCountsText(5, 3), '5 waiting, 3 discharged');
  assert.equal(patientCountsText(5, null), '5 waiting');
  assert.equal(patientCountsText(null, 0), '0 discharged');
  assert.equal(patientCountsText(null, null), null);
});

test('a vitals line holds only the sittings that read that value, oldest first', () => {
  const sittings = [
    sitting('a', at(13, 1), 82, 16),
    sitting('b', at(13, 30), null, null),
    sitting('c', at(14, 0), 108, null),
    sitting('d', null, null, null),
  ];
  assert.deepEqual(
    vitalSeries(sittings, 'heartRate').map((point) => point.value),
    [82, 108],
  );
  assert.deepEqual(
    vitalSeries(sittings, 'breathingRate').map((point) => point.value),
    [16],
  );
});

test('sitting rows are newest first and say what each sitting gave', () => {
  const rows = sittingRows(
    [sitting('a', at(13, 1), 82.4, 16), sitting('b', at(13, 30), null, null), sitting('c', null, null, null)],
    NOW,
  );
  assert.deepEqual(
    rows.map((row) => row.key),
    ['c', 'b', 'a'],
  );
  assert.equal(rows[0]!.running, true);
  assert.equal(rows[0]!.detail, null);
  assert.equal(rows[1]!.pulse, null);
  assert.equal(rows[1]!.detail, '60 s, no pulse or breathing could be read');
  assert.equal(rows[2]!.title, 'Check-in sitting');
  assert.equal(rows[2]!.pulse, '82');
  assert.equal(rows[2]!.breathing, '16');
  assert.equal(rows[2]!.detail, '60 s, pulse read 83% of the time');
  assert.equal(rows[2]!.sourceLabel, 'Simulated');
});

test('the connection has three states, each with its own words', () => {
  assert.equal(connectionText('live'), 'Live');
  assert.equal(connectionText('polling'), 'Updating every 5 s');
  assert.equal(connectionText('offline'), 'Server unreachable');
});
