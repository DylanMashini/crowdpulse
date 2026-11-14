import {
  type Flag,
  type FlagAlert,
  type FlagRule,
  type Patient,
  type Sitting,
  flagAlerts,
  isLowConfidence,
} from '@triagecam/contracts';

import { clockTime, percent, wholeNumber } from '../format.ts';
import { sourceLabel } from './worklistFormat.ts';

// Words and orderings for the nurse tabs. Pure, so they are tested without a phone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole minutes from `iso` to `now`, never negative. Null when `iso` is not a time. */
export function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 60_000));
}

/** "14:02" for today, "13 Nov, 14:02" for another day, in the device's zone. */
export function dayTime(iso: string, now: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? clockTime(iso) : `${date.getDate()} ${MONTHS[date.getMonth()]}, ${clockTime(iso)}`;
}

/** Whole years from a `YYYY-MM-DD` date of birth to `now`. Null when the date is unusable. */
export function ageInYears(dateOfBirth: string | null, now: number): number | null {
  const match = dateOfBirth ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const today = new Date(now);
  const hadBirthday = today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  const age = today.getFullYear() - year - (hadBirthday ? 0 : 1);
  return age >= 0 ? age : null;
}

/** "18 Apr 1991" from a calendar date. It has no zone, so none is applied. */
export function calendarDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

const SEX_WORDS = { female: 'Female', male: 'Male', other: 'Other' } as const;

/** "34 y, female" for the line under a name. Null when neither is known. */
export function demographics(patient: Pick<Patient, 'dateOfBirth' | 'sex'>, now: number): string | null {
  const age = ageInYears(patient.dateOfBirth, now);
  const parts = [age != null ? `${age} y` : null, patient.sex ? SEX_WORDS[patient.sex].toLowerCase() : null];
  return parts.filter(Boolean).join(', ') || null;
}

export type IntakeRow = { label: string; value: string };

/** What staff typed at check-in, in the order a nurse reads it. Only what has been entered. */
export function intakeRows(patient: Patient, now: number): IntakeRow[] {
  const age = ageInYears(patient.dateOfBirth, now);
  const rows: (IntakeRow | null)[] = [
    patient.reasonForVisit ? { label: 'Reason for visit', value: patient.reasonForVisit } : null,
    patient.painScore != null ? { label: 'Pain, as reported', value: `${patient.painScore} of 10` } : null,
    patient.allergies ? { label: 'Allergies', value: patient.allergies } : null,
    patient.notes ? { label: 'Notes', value: patient.notes } : null,
    patient.dateOfBirth
      ? {
          label: 'Date of birth',
          value: age != null ? `${calendarDate(patient.dateOfBirth)} (${age} y)` : calendarDate(patient.dateOfBirth),
        }
      : null,
    patient.sex ? { label: 'Sex', value: SEX_WORDS[patient.sex] } : null,
  ];
  return rows.filter((row): row is IntakeRow => row !== null);
}

const isOpen = (flag: Flag) => flag.closedAt == null;

/**
 * Open flags as the Flags tab lists them, gathered into alerts (`Flag.alertId`): the alerts
 * nobody has acknowledged first, then the rest. Inside each group trend alerts come before
 * overdue ones, and the longest open leads. One deterioration is one alert, whichever rules
 * it tripped, so this is also what every count of "to acknowledge" is taken from.
 */
export function flagGroups(flags: Flag[]): { unacknowledged: FlagAlert[]; acknowledged: FlagAlert[] } {
  const alerts = flagAlerts(flags.filter(isOpen));
  const order = (a: FlagAlert, b: FlagAlert) =>
    Number(a.lead.rule === 'overdue') - Number(b.lead.rule === 'overdue') || a.lead.openedAt.localeCompare(b.lead.openedAt);
  return {
    unacknowledged: alerts.filter((alert) => alert.acknowledgedAt == null).sort(order),
    acknowledged: alerts.filter((alert) => alert.acknowledgedAt != null).sort(order),
  };
}

/** How many alerts still need someone: the Flags badge and a worklist card's "to acknowledge". */
export function alertsToAcknowledge(flags: Flag[]): number {
  return flagGroups(flags).unacknowledged.length;
}

/** "1 flag to acknowledge". To the nurse an alert is a flag; null when nothing is waiting. */
export function toAcknowledgeText(flags: Flag[]): string | null {
  const waiting = alertsToAcknowledge(flags);
  return waiting === 0 ? null : waiting === 1 ? '1 flag to acknowledge' : `${waiting} flags to acknowledge`;
}

/**
 * Which of the open flags are news to this phone. An alert is announced once: when neither
 * it nor any of its flags has been shown before, and somebody still has to acknowledge it.
 * `seen` comes back with everything now open added, so the second flag of an alert that
 * arrives a moment after the first, or an alert opened from a tapped push, is never announced
 * again.
 */
export function announcements(open: Flag[], seen: ReadonlySet<string>): { alerts: FlagAlert[]; seen: Set<string> } {
  const known = (alert: FlagAlert) => seen.has(alert.id) || alert.flags.some((flag) => seen.has(flag.id));
  const alerts = flagAlerts(open.filter(isOpen)).filter((alert) => !known(alert) && alert.waiting.length > 0);
  const next = new Set(seen);
  for (const flag of open) {
    next.add(flag.id);
    next.add(flag.alertId);
  }
  return { alerts, seen: next };
}

/**
 * Banners brought up to date with the open flags: a banner follows its alert, so acknowledged
 * elsewhere it says so, and closed it goes away.
 */
export function followAlerts(banners: FlagAlert[], open: Flag[]): FlagAlert[] {
  const alerts = flagAlerts(open.filter(isOpen));
  return banners.flatMap((banner) => alerts.filter((alert) => alert.id === banner.id));
}

/**
 * The flags as they stand after the server answered an acknowledgement with `acknowledged`.
 * The server acknowledges the whole alert in that one request: the open flags of the same
 * alert that nobody had acknowledged take the same time and name. Other alerts are untouched.
 */
export function withAcknowledgement(flags: Flag[], acknowledged: Flag): Flag[] {
  return flags.map((flag) => {
    if (flag.id === acknowledged.id) return acknowledged;
    const covered = flag.alertId === acknowledged.alertId && flag.closedAt == null && flag.acknowledgedAt == null;
    return covered
      ? { ...flag, acknowledgedAt: acknowledged.acknowledgedAt, acknowledgedBy: acknowledged.acknowledgedBy }
      : flag;
  });
}

/**
 * What a flag is about, for its badge. An alert that tripped both trend rules carries both
 * badges on its one card.
 */
export function flagRuleLabel(rule: FlagRule, reCheckBaseline = false): string {
  switch (rule) {
    case 'score_rise':
      return 'Score above check-in';
    case 'baseline_shift':
      // A baseline that is a re-check's is not called check-in.
      return reCheckBaseline ? 'Change from baseline' : 'Change from check-in';
    case 'overdue':
      return 'Re-check overdue';
  }
}

/** "Opened 14:02, 12 min ago". */
export function flagOpenedText(flag: Pick<Flag, 'openedAt'>, now: number): string {
  const minutes = minutesSince(flag.openedAt, now);
  const age = minutes == null ? '' : minutes < 1 ? ', just now' : minutes < 60 ? `, ${minutes} min ago` : '';
  return `Opened ${dayTime(flag.openedAt, now)}${age}`;
}

/** "Acknowledged 14:05 by nurse@ward.test". */
export function flagAcknowledgedText(flag: Pick<Flag, 'acknowledgedAt' | 'acknowledgedBy'>, now: number): string {
  if (!flag.acknowledgedAt) return '';
  return `Acknowledged ${dayTime(flag.acknowledgedAt, now)}${flag.acknowledgedBy ? ` by ${flag.acknowledgedBy}` : ''}`;
}

export type PatientFilter = 'waiting' | 'discharged' | 'all';

/**
 * The Patients tab's list: one status, narrowed by what was typed. A number finds the visit
 * number ("14", "no. 14"); words must each appear in the name or the reason for the visit.
 */
export function filterPatients(patients: Patient[], filter: PatientFilter, query: string): Patient[] {
  const words = query
    .toLowerCase()
    .replace(/\bno\.?\s*(?=\d)/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return patients.filter((patient) => {
    if (filter !== 'all' && patient.status !== filter) return false;
    const text = `${patient.name ?? ''} ${patient.reasonForVisit ?? ''}`.toLowerCase();
    return words.every((word) => (/^\d+$/.test(word) ? String(patient.number).startsWith(word) : text.includes(word)));
  });
}

/**
 * "5 waiting, 3 discharged" under the Patients title. A count that is not known in full is
 * passed as null and left out, never guessed from a part of the list.
 */
export function patientCountsText(waiting: number | null, discharged: number | null): string | null {
  const parts = [waiting != null ? `${waiting} waiting` : null, discharged != null ? `${discharged} discharged` : null];
  return parts.filter(Boolean).join(', ') || null;
}

export type VitalPoint = { at: number; value: number };

/** The sitting's heart rate if it is one that counts: not a lower-confidence one. */
function trustedHeartRate(sitting: Sitting): number | null {
  const summary = sitting.summary;
  return !summary || isLowConfidence(summary.heartRateConfidence) ? null : summary.heartRate.value;
}

const vitalValue = (sitting: Sitting, vital: 'heartRate' | 'breathingRate'): number | null =>
  vital === 'heartRate' ? trustedHeartRate(sitting) : (sitting.summary?.breathingRate.value ?? null);

/** The sittings that gave this value, with their points, oldest first. */
function measured(sittings: Sitting[], vital: 'heartRate' | 'breathingRate'): { sitting: Sitting; point: VitalPoint }[] {
  return sittings
    .flatMap((sitting) => {
      const value = vitalValue(sitting, vital);
      const at = sitting.endedAt ? new Date(sitting.endedAt).getTime() : Number.NaN;
      return value == null || Number.isNaN(at) ? [] : [{ sitting, point: { at, value } }];
    })
    .sort((a, b) => a.point.at - b.point.at);
}

/**
 * One line of the vitals history: every sitting that gave this value, oldest first. A
 * lower-confidence heart rate is not in it: the station uses it for no baseline and no trend,
 * and neither does the chart.
 */
export function vitalSeries(sittings: Sitting[], vital: 'heartRate' | 'breathingRate'): VitalPoint[] {
  return measured(sittings, vital).map(({ point }) => point);
}

export type VitalTrend = {
  /** What the line is drawn from; the first point is the baseline. */
  points: VitalPoint[];
  /** Where the baseline is from, to finish "+30 from 55 ...": "at check-in" or "at the 10:42 re-check". */
  baseFrom: string;
  /** The pulse the newest finished sitting gave with lower confidence, if it did. Shown tagged, beside the line. */
  lowConfidence: number | null;
};

/** Everything VitalHistory shows for one vital, as the station counts it. */
export function vitalTrend(sittings: Sitting[], vital: 'heartRate' | 'breathingRate'): VitalTrend {
  const series = measured(sittings, vital);
  const first = series[0]?.sitting;
  const baseFrom = first && first.kind !== 'check_in' && first.endedAt ? `at the ${clockTime(first.endedAt)} re-check` : 'at check-in';
  const newest = sittings
    .filter((sitting) => sitting.summary != null && sitting.endedAt != null)
    .sort((a, b) => new Date(a.endedAt!).getTime() - new Date(b.endedAt!).getTime())
    .at(-1);
  const weak = vital === 'heartRate' && newest && trustedHeartRate(newest) == null ? (newest.summary?.heartRate.value ?? null) : null;
  return { points: series.map(({ point }) => point), baseFrom, lowConfidence: weak };
}

/**
 * Whole minutes since the last sitting that gave a pulse that counts or a breathing rate, or
 * null: what the station calls "last observed". A lower-confidence pulse alone is no observation.
 */
export function lastObservedMinutes(sittings: Sitting[], now: number): number | null {
  const observed = sittings
    .filter((sitting) => sitting.endedAt && (trustedHeartRate(sitting) != null || sitting.summary?.breathingRate.value != null))
    .map((sitting) => sitting.endedAt!)
    .sort();
  return minutesSince(observed.at(-1), now);
}

export type SittingRow = {
  key: string;
  /** When it ended, or started if it is still running. */
  time: string;
  title: string;
  running: boolean;
  /** Rounded, without units. Null is "No reading". */
  pulse: string | null;
  /** The pulse is a lower-confidence one: the row tags it. */
  pulseLowConfidence: boolean;
  breathing: string | null;
  /** "58 s, pulse read 83% of the time". Null while it runs. */
  detail: string | null;
  sourceLabel: string | null;
};

/** Every sitting for the patient screen, newest first. */
export function sittingRows(sittings: Sitting[], now: number): SittingRow[] {
  return [...sittings].reverse().map((sitting) => {
    const summary = sitting.summary;
    const title = sitting.kind === 'check_in' ? 'Check-in sitting' : 'Re-check';
    const running = sitting.endedAt == null;
    const pulse = summary?.heartRate.value;
    const breathing = summary?.breathingRate.value;
    let detail: string | null = null;
    if (summary) {
      const seconds = `${Math.round(summary.durationSeconds)} s`;
      detail =
        pulse == null
          ? `${seconds}, no pulse or breathing could be read`
          : isLowConfidence(summary.heartRateConfidence)
            ? `${seconds}, lower-confidence pulse, not used for trends or flags`
            : `${seconds}, pulse read ${percent(summary.heartRate.coverage)} of the time`;
      if (pulse == null && breathing != null) detail = `${seconds}, breathing only`;
    } else if (!running) {
      detail = 'Ended without a summary';
    }
    return {
      key: sitting.id,
      time: dayTime(sitting.endedAt ?? sitting.startedAt, now),
      title,
      running,
      pulse: pulse != null ? wholeNumber(pulse) : null,
      pulseLowConfidence: pulse != null && isLowConfidence(summary?.heartRateConfidence),
      breathing: breathing != null ? wholeNumber(breathing) : null,
      detail,
      sourceLabel: sourceLabel(sitting.source),
    };
  });
}

export type Connection =
  /** The event stream is open: changes arrive as they happen. */
  | 'live'
  /** The stream is down but requests succeed: the lists refresh every few seconds. */
  | 'polling'
  /** Requests are failing: what is on screen is the last answer the server gave. */
  | 'offline';

/** The words beside the connection dot. */
export function connectionText(connection: Connection): string {
  switch (connection) {
    case 'live':
      return 'Live';
    case 'polling':
      return 'Updating every 5 s';
    case 'offline':
      return 'Server unreachable';
  }
}
