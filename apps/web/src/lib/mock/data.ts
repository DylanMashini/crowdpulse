// Contract-shaped data for building the dashboard before the API routes exist. Loaded only when
// NEXT_PUBLIC_API_MOCK=1. Nothing here is measured: every number is made up.

import {
  defaultSettings,
  type Device,
  type Estimate,
  type Flag,
  type Settings,
  type Sitting,
  type Statistics,
  type StoredReading,
  patientLabel,
  type Patient,
  type PatientDetailResponse,
  type PatientIntake,
  type PatientRef,
  type TimelineEntry,
  type User,
  type WorklistItem,
} from '@triagecam/contracts';

import { breathsPerMin, heartRate, minutes, minutesAgo, rate } from '@/lib/format';

const MINUTE = 60_000;
/** Everything is placed relative to the moment the mock was loaded. */
export const loadedAt = Date.now();

const iso = (ms: number) => new Date(ms).toISOString();
const ago = (minutes: number) => iso(loadedAt - minutes * MINUTE);
const uuid = (kind: number, n: number) => `00000000-0000-4000-8000-${String(kind).padStart(4, '0')}${String(n).padStart(8, '0')}`;

export const user: User = { id: uuid(1, 1), email: 'operator@station.test', emailVerified: true, createdAt: ago(600) };

export const CAMERA_ID = uuid(2, 1);
export const devices: Device[] = [
  { id: CAMERA_ID, role: 'camera', label: 'Front desk phone', hasPushToken: false, lastSeenAt: ago(0), liveAt: ago(0) },
  { id: uuid(2, 2), role: 'camera', label: 'Bay 2 phone', hasPushToken: false, lastSeenAt: ago(47), liveAt: null },
  { id: uuid(2, 3), role: 'nurse', label: 'Charge nurse phone', hasPushToken: true, lastSeenAt: ago(1), liveAt: null },
];

export const settings: { value: Settings; updatedAt: string } = { value: { ...defaultSettings }, updatedAt: ago(180) };

interface Seed {
  number: number;
  waitedMin: number;
  state: WorklistItem['state'];
  observedMin: number | null;
  pulse: [base: number | null, now: number | null];
  breathing: [base: number | null, now: number | null];
  score: WorklistItem['score'];
  scoreAtCheckIn: WorklistItem['score'];
  source: WorklistItem['source'];
  flag?: Flag['rule'];
}

const seeds: Seed[] = [
  { number: 14, waitedMin: 29, state: 'flag', observedMin: 3, pulse: [82, 108], breathing: [16, 24], score: 2, scoreAtCheckIn: 0, source: 'camera', flag: 'score_rise' },
  { number: 11, waitedMin: 64, state: 'overdue', observedMin: 41, pulse: [74, 78], breathing: [14, 15], score: 0, scoreAtCheckIn: 0, source: 'camera', flag: 'overdue' },
  { number: 15, waitedMin: 24, state: 'no-reading', observedMin: 22, pulse: [88, null], breathing: [18, null], score: null, scoreAtCheckIn: 0, source: 'camera' },
  { number: 12, waitedMin: 52, state: 'observed', observedMin: 12, pulse: [68, 71], breathing: [15, 14], score: 0, scoreAtCheckIn: 0, source: 'recording' },
  { number: 16, waitedMin: 18, state: 'observed', observedMin: 6, pulse: [95, 92], breathing: [19, 18], score: 1, scoreAtCheckIn: 1, source: 'simulated' },
];

export const RUNNING_PATIENT = 17;

/** What staff typed at intake, by visit number. Patient 17 is mid-intake, so only the name is in. */
const intakes = new Map<number, PatientIntake>([
  [11, { name: 'Priya Raman', dateOfBirth: '2003-12-11', sex: 'female', reasonForVisit: 'Migraine, nausea', painScore: 7, allergies: null, notes: 'Light sensitive.' }],
  [12, { name: 'Daniel Whitfield', dateOfBirth: '1979-06-27', sex: 'male', reasonForVisit: 'Cut to the left hand', painScore: 3, allergies: 'Latex', notes: null }],
  [13, { name: 'Elena Sokolova', dateOfBirth: '1986-01-30', sex: 'female', reasonForVisit: 'Sore throat for three days', painScore: 2, allergies: null, notes: null }],
  [14, { name: 'Robert Okafor', dateOfBirth: '1958-09-02', sex: 'male', reasonForVisit: 'Short of breath since this morning', painScore: 2, allergies: null, notes: 'History of COPD.' }],
  [15, { name: 'Maya Chen', dateOfBirth: '1991-04-18', sex: 'female', reasonForVisit: 'Twisted ankle, swelling', painScore: 4, allergies: 'Penicillin', notes: null }],
  [16, { name: 'Tomás Alvarez', dateOfBirth: '1996-08-05', sex: 'male', reasonForVisit: 'Fever and cough', painScore: 1, allergies: null, notes: null }],
  [17, { name: 'Grace Lindqvist', dateOfBirth: null, sex: null, reasonForVisit: null, painScore: null, allergies: null, notes: null }],
]);
const NO_INTAKE: PatientIntake = { name: null, dateOfBirth: null, sex: null, reasonForVisit: null, painScore: null, allergies: null, notes: null };
const intakeOf = (number: number): PatientIntake => intakes.get(number) ?? NO_INTAKE;

/** The mock has no photos, so every avatar shows initials. */
export const refOf = (number: number): PatientRef => ({ number, name: intakeOf(number).name, photoUpdatedAt: null });
const labelOf = (number: number) => patientLabel(refOf(number));

/** Applies the intake fields of a PATCH body; anything else in it is ignored. */
export function updateIntake(number: number, changes: Record<string, unknown>): void {
  const next: Record<string, unknown> = { ...intakeOf(number) };
  for (const key of Object.keys(NO_INTAKE)) {
    if (key in changes) next[key] = changes[key] === '' ? null : changes[key];
  }
  intakes.set(number, next as PatientIntake);
}

function ageOf(number: number): number | null {
  const born = intakeOf(number).dateOfBirth;
  return born ? new Date(loadedAt).getFullYear() - Number(born.slice(0, 4)) : null;
}
/** The check-in sitting that is running when the mock loads. It finishes after 60 seconds. */
export const runningStart = loadedAt - 25_000;
export const RUNNING_SECONDS = 60;
export const runningSittingId = uuid(3, 1700);

export const acknowledged = new Map<string, string>();
export const discharged = new Map<number, string>([[13, ago(95)]]);

/** The server's fixed template, written out with the same formatters. */
function handoffFor(seed: Seed): string {
  const [pulseBase, pulseNow] = seed.pulse;
  const [breathingBase, breathingNow] = seed.breathing;
  if (pulseBase == null || breathingBase == null) return `${labelOf(seed.number)}: not measured at check-in.`;
  const later = minutes(seed.waitedMin - (seed.observedMin ?? 0) - 2);
  const pulse =
    pulseNow == null ? `pulse ${heartRate(pulseBase)} at check-in, no reading now` : `pulse ${heartRate(pulseBase)} at check-in, ${heartRate(pulseNow)} now (${later} later)`;
  const breathing =
    breathingNow == null ? `breathing ${breathsPerMin(breathingBase)} at check-in, no reading now` : `breathing ${rate(breathingBase)} to ${breathsPerMin(breathingNow)}`;
  return `${labelOf(seed.number)}: ${pulse}; ${breathing}. Last observed ${minutesAgo(seed.observedMin ?? 0)}.`;
}

const CHECK_IN_ONLY = `pulse ${heartRate(77)}, breathing ${breathsPerMin(16)} at check-in`;

function flagFor(seed: Seed): Flag | null {
  if (!seed.flag) return null;
  const id = uuid(4, seed.number);
  const acknowledgedAt = acknowledged.get(id) ?? null;
  return {
    id,
    patientNumber: seed.number,
    patient: refOf(seed.number),
    rule: seed.flag,
    openedAt: ago(seed.flag === 'overdue' ? (seed.observedMin ?? 0) - 30 : (seed.observedMin ?? 0)),
    closedAt: discharged.has(seed.number) ? discharged.get(seed.number)! : null,
    detail: {
      pulse: { base: seed.pulse[0], now: seed.pulse[1] },
      breathing: { base: seed.breathing[0], now: seed.breathing[1] },
      scoreAtCheckIn: seed.scoreAtCheckIn,
      scoreNow: seed.score,
      minutesSinceCheckIn: seed.waitedMin - 2,
      minutesSinceObserved: seed.flag === 'overdue' ? 30 : null,
    },
    acknowledgedAt,
    acknowledgedBy: acknowledgedAt ? user.email : null,
    handoff: handoffFor(seed),
  };
}

export function runningFinished(now = Date.now()): boolean {
  return now - runningStart >= RUNNING_SECONDS * 1000;
}

export function worklistItems(): WorklistItem[] {
  const waiting = seeds.filter((seed) => !discharged.has(seed.number));
  const items = waiting.map((seed): Omit<WorklistItem, 'rank'> => {
    const flag = flagFor(seed);
    return {
      patientNumber: seed.number,
      patient: refOf(seed.number),
      reasonForVisit: intakeOf(seed.number).reasonForVisit,
      ageYears: ageOf(seed.number),
      state: seed.state,
      waitingSince: ago(seed.waitedMin),
      lastObservedAt: seed.observedMin == null ? null : ago(seed.observedMin),
      minutesSinceObserved: seed.observedMin,
      pulse: { base: seed.pulse[0], now: seed.pulse[1] },
      breathing: { base: seed.breathing[0], now: seed.breathing[1] },
      score: seed.score,
      scoreAtCheckIn: seed.scoreAtCheckIn,
      parametersMeasured: seed.score == null ? 0 : 2,
      source: seed.source,
      flags: flag ? [flag] : [],
      handoff: handoffFor(seed),
      sittingInProgress: false,
    };
  });
  if (!discharged.has(RUNNING_PATIENT)) {
    const done = runningFinished();
    items.push({
      patientNumber: RUNNING_PATIENT,
      patient: refOf(RUNNING_PATIENT),
      reasonForVisit: intakeOf(RUNNING_PATIENT).reasonForVisit,
      ageYears: ageOf(RUNNING_PATIENT),
      state: 'observed',
      waitingSince: iso(runningStart - 40_000),
      lastObservedAt: done ? iso(runningStart + RUNNING_SECONDS * 1000) : null,
      minutesSinceObserved: done ? 0 : null,
      pulse: { base: done ? 77 : null, now: done ? 77 : null },
      breathing: { base: done ? 16 : null, now: done ? 16 : null },
      score: done ? 0 : null,
      scoreAtCheckIn: done ? 0 : null,
      parametersMeasured: done ? 2 : 0,
      source: done ? 'camera' : null,
      flags: [],
      handoff: done ? `${labelOf(RUNNING_PATIENT)}: ${CHECK_IN_ONLY}. Last observed just now.` : `${labelOf(RUNNING_PATIENT)}: not yet observed, waiting under 1 min.`,
      sittingInProgress: !done,
    });
  }
  return items.map((item, index) => ({ ...item, rank: index + 1 }));
}

export function patients(): Patient[] {
  const numbers = [RUNNING_PATIENT, ...seeds.map((seed) => seed.number), 13].sort((a, b) => b - a);
  return numbers.map((number) => {
    const seed = seeds.find((candidate) => candidate.number === number);
    const dischargedAt = discharged.get(number) ?? null;
    return {
      ...intakeOf(number),
      number,
      intakeCompletedAt: number === RUNNING_PATIENT ? null : ago((seed?.waitedMin ?? 170) - 1),
      photoUpdatedAt: null,
      status: dischargedAt ? 'discharged' : 'waiting',
      createdAt: number === RUNNING_PATIENT ? iso(runningStart - 40_000) : ago(seed?.waitedMin ?? 170),
      dischargedAt,
      faceOptIn: number % 2 === 0,
      faceEnrolled: number % 2 === 0 && !dischargedAt,
    };
  });
}

const valid = (value: number, coverage: number): Estimate => ({ value, state: 'valid', reason: null, quality: 0.82, coverage, ageMs: 0 });
const waiting = (state: 'settling' | 'none', reason: Estimate['reason'], coverage: number): Estimate => ({
  value: null,
  state,
  reason,
  quality: 0.2,
  coverage,
  ageMs: null,
});

/** The reading for second `i` of the running sitting. Second 31 to 34 is a movement gap. */
export function runningReading(i: number): StoredReading {
  const heartValid = (second: number) => second >= 10 && (second < 31 || second > 34);
  let validSoFar = 0;
  for (let second = 0; second <= i; second++) if (heartValid(second)) validSoFar++;
  const coverage = validSoFar / (i + 1);
  const heartRate = heartValid(i)
    ? valid(76 + Math.round(3 * Math.sin(i / 5)), coverage)
    : i < 4
      ? waiting('settling', 'warming_up', 0)
      : i < 10
        ? waiting('settling', 'awaiting_agreement', 0)
        : waiting('none', 'motion', coverage);
  const breathingCoverage = Math.max(0, i - 29) / (i + 1);
  const breathingRate =
    i >= 30 ? valid(16, breathingCoverage) : waiting('settling', i < 25 ? 'warming_up' : 'awaiting_agreement', 0);
  return { t: iso(runningStart + i * 1000), heartRate, breathingRate };
}

const summaryValue = (value: number | null, coverage: number) => ({ value, coverage });

function sittingOf(id: string, patientNumber: number, kind: Sitting['kind'], source: Sitting['source'], endedMinAgo: number, heartRate: number | null, breathingRate: number | null): Sitting {
  const endedAt = loadedAt - endedMinAgo * MINUTE;
  return {
    id,
    patientNumber,
    deviceId: CAMERA_ID,
    kind,
    source,
    startedAt: iso(endedAt - MINUTE),
    endedAt: iso(endedAt),
    clockOffsetMs: 12,
    summary: {
      durationSeconds: 60,
      heartRate: summaryValue(heartRate, heartRate == null ? 0.08 : 0.86),
      breathingRate: summaryValue(breathingRate, breathingRate == null ? 0 : 0.5),
      rmssd: summaryValue(heartRate == null ? null : 34, heartRate == null ? 0 : 0.71),
      sdnn: summaryValue(heartRate == null ? null : 41, heartRate == null ? 0 : 0.71),
      timeToFirstReadingSeconds: heartRate == null ? null : 10,
      longestDropoutSeconds: heartRate == null ? 55 : 4,
      frameCount: 3588,
      droppedFrames: 12,
    },
  };
}

export function runningSitting(now = Date.now()): Sitting {
  const done = runningFinished(now);
  const finished = sittingOf(runningSittingId, RUNNING_PATIENT, 'check_in', 'camera', 0, 77, 16);
  return {
    ...finished,
    startedAt: iso(runningStart),
    endedAt: done ? iso(runningStart + RUNNING_SECONDS * 1000) : null,
    summary: done ? finished.summary : null,
  };
}

export function patientDetail(number: number): PatientDetailResponse | null {
  const patient = patients().find((candidate) => candidate.number === number);
  if (!patient) return null;
  const isDischarged = patient.status === 'discharged';

  if (number === RUNNING_PATIENT) {
    const sitting = runningSitting();
    const item = worklistItems().find((candidate) => candidate.patientNumber === number);
    const timeline: TimelineEntry[] = [{ type: 'created', at: patient.createdAt }];
    if (sitting.endedAt) {
      timeline.unshift({ type: 'sitting', at: sitting.endedAt, sittingId: sitting.id, kind: 'check_in', source: 'camera', heartRate: 77, breathingRate: 16, score: 0 });
    }
    if (patient.dischargedAt) timeline.unshift({ type: 'discharged', at: patient.dischargedAt });
    return {
      patient,
      state: isDischarged ? null : 'observed',
      baseline: sitting.endedAt ? sitting : null,
      sittings: [sitting],
      flags: [],
      timeline,
      handoff: item?.handoff ?? `${labelOf(number)}: ${CHECK_IN_ONLY}. Last observed just now.`,
    };
  }

  const seed = seeds.find((candidate) => candidate.number === number);
  if (!seed) {
    const baseline = sittingOf(uuid(3, number * 100), number, 'check_in', 'camera', 168, 71, 15);
    return {
      patient,
      state: null,
      baseline,
      sittings: [baseline],
      flags: [],
      timeline: [
        { type: 'discharged', at: patient.dischargedAt ?? ago(95) },
        { type: 'sitting', at: baseline.endedAt!, sittingId: baseline.id, kind: 'check_in', source: 'camera', heartRate: 71, breathingRate: 15, score: 0 },
        { type: 'created', at: patient.createdAt },
      ],
      handoff: `${labelOf(number)}: pulse ${heartRate(71)}, breathing ${breathsPerMin(15)} at check-in.`,
    };
  }

  const source = seed.source ?? 'camera';
  const baseline = sittingOf(uuid(3, number * 100), number, 'check_in', source, seed.waitedMin - 2, seed.pulse[0], seed.breathing[0]);
  const recheckAgo = seed.state === 'no-reading' ? 4 : (seed.observedMin ?? 0);
  const recheck = sittingOf(uuid(3, number * 100 + 1), number, 'recheck', source, recheckAgo, seed.pulse[1], seed.breathing[1]);
  const flag = flagFor(seed);
  const timeline: TimelineEntry[] = [
    { type: 'sitting', at: recheck.endedAt!, sittingId: recheck.id, kind: 'recheck', source, heartRate: seed.pulse[1], breathingRate: seed.breathing[1], score: seed.score },
    { type: 'sitting', at: baseline.endedAt!, sittingId: baseline.id, kind: 'check_in', source, heartRate: seed.pulse[0], breathingRate: seed.breathing[0], score: seed.scoreAtCheckIn },
    { type: 'created', at: patient.createdAt },
  ];
  if (flag) {
    const opened: TimelineEntry = { type: 'flag_opened', at: flag.openedAt, flagId: flag.id, rule: flag.rule, handoff: flag.handoff };
    timeline.unshift(opened);
    if (flag.acknowledgedAt) timeline.unshift({ type: 'flag_acknowledged', at: flag.acknowledgedAt, flagId: flag.id, by: user.email });
    if (flag.closedAt) timeline.unshift({ type: 'flag_closed', at: flag.closedAt, flagId: flag.id, rule: flag.rule });
  }
  if (patient.dischargedAt) timeline.unshift({ type: 'discharged', at: patient.dischargedAt });
  return {
    patient,
    state: isDischarged ? null : seed.state,
    baseline,
    sittings: [baseline, recheck],
    flags: flag ? [flag] : [],
    timeline,
    handoff: handoffFor(seed),
  };
}

export function findFlag(id: string): Flag | null {
  for (const seed of seeds) {
    const flag = flagFor(seed);
    if (flag?.id === id) return flag;
  }
  return null;
}

export function statistics(empty: boolean): Statistics {
  const now = Date.now();
  const range = { generatedAt: iso(now), from: iso(new Date(now).setHours(0, 0, 0, 0)), to: iso(now), recheckIntervalMin: settings.value.recheckIntervalMin };
  const noRates = { sittings: 0, median: null, lowest: null, highest: null, bins: [] };
  if (empty) {
    return {
      ...range,
      patients: { seen: 0, arrived: 0, discharged: 0, medianMinutesToFirstObservation: null, medianMinutesToDischarge: null },
      waitingNow: {
        patients: 0,
        byState: { observed: 0, flag: 0, overdue: 0, 'no-reading': 0 },
        medianMinutesWaiting: null,
        longestMinutesWaiting: null,
        medianMinutesSinceObserved: null,
        longestMinutesSinceObserved: null,
      },
      sittings: {
        finished: 0,
        withReading: 0,
        checkIns: 0,
        rechecks: 0,
        meanPerPatient: null,
        medianMinutesBetweenObservations: null,
        meanHeartRateCoverage: null,
        meanBreathingRateCoverage: null,
        medianTimeToFirstReadingSeconds: null,
      },
      heartRate: noRates,
      breathingRate: noRates,
      flags: { raised: 0, byRule: { score_rise: 0, baseline_shift: 0, overdue: 0 }, acknowledged: 0, medianMinutesToAcknowledge: null, openNow: 0, unacknowledgedNow: 0 },
      perPatient: [],
    };
  }

  const waiting = seeds.filter((seed) => !discharged.has(seed.number));
  const byState = { observed: 0, flag: 0, overdue: 0, 'no-reading': 0 };
  for (const seed of waiting) byState[seed.state] += 1;
  const bins = (from: number, width: number, counts: number[]) =>
    counts.map((sittings, index) => ({ from: from + index * width, to: from + (index + 1) * width - 1, sittings }));

  return {
    ...range,
    patients: { seen: seeds.length + 2, arrived: seeds.length + 2, discharged: discharged.size, medianMinutesToFirstObservation: 2.4, medianMinutesToDischarge: 95.2 },
    waitingNow: {
      patients: waiting.length,
      byState,
      medianMinutesWaiting: 29.3,
      longestMinutesWaiting: 64.8,
      medianMinutesSinceObserved: 12.1,
      longestMinutesSinceObserved: 41.6,
    },
    sittings: {
      finished: 13,
      withReading: 11,
      checkIns: 7,
      rechecks: 6,
      meanPerPatient: 1.857,
      medianMinutesBetweenObservations: 21.5,
      meanHeartRateCoverage: 0.7812,
      meanBreathingRateCoverage: 0.6431,
      medianTimeToFirstReadingSeconds: 11.5,
    },
    heartRate: { sittings: 11, median: 78.42, lowest: 67.9, highest: 108.3, bins: bins(51, 10, [0, 2, 4, 2, 1, 2]) },
    breathingRate: { sittings: 10, median: 16.2, lowest: 13.8, highest: 24.1, bins: bins(12, 3, [3, 4, 1, 1, 1]) },
    flags: { raised: 3, byRule: { score_rise: 1, baseline_shift: 0, overdue: 2 }, acknowledged: acknowledged.size, medianMinutesToAcknowledge: acknowledged.size ? 4.3 : null, openNow: 2, unacknowledgedNow: 2 - Math.min(2, acknowledged.size) },
    perPatient: seeds.map((seed) => {
      const left = discharged.get(seed.number) ?? null;
      const [pulseBase, pulseNow] = seed.pulse;
      return {
        patientNumber: seed.number,
        patient: refOf(seed.number),
        status: left ? ('discharged' as const) : ('waiting' as const),
        state: left ? null : seed.state,
        arrivedAt: ago(seed.waitedMin),
        dischargedAt: left,
        minutesInRoom: seed.waitedMin,
        minutesSinceObserved: left ? null : seed.observedMin,
        sittings: 2,
        observations: pulseNow == null ? 1 : 2,
        pulse: { base: pulseBase, now: pulseNow },
        breathing: { base: seed.breathing[0], now: seed.breathing[1] },
        // Unrounded on purpose: the mock should exercise the formatters as the engine does.
        heartRates: [pulseBase, pulseNow].flatMap((value) => (value == null ? [] : [value + 0.763824])),
        score: seed.score,
        flags: seed.flag ? 1 : 0,
      };
    }),
  };
}
