import type { Flag, FlagRule, Patient, Sitting } from '@triagecam/contracts';

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

/**
 * Open flags as the Flags tab lists them: the ones nobody has acknowledged first, then the
 * rest. Inside each group trend flags come before overdue ones, and the longest open leads.
 */
export function flagGroups(flags: Flag[]): { unacknowledged: Flag[]; acknowledged: Flag[] } {
  const open = flags.filter((flag) => flag.closedAt == null);
  const order = (a: Flag, b: Flag) =>
    Number(a.rule === 'overdue') - Number(b.rule === 'overdue') || a.openedAt.localeCompare(b.openedAt);
  return {
    unacknowledged: open.filter((flag) => flag.acknowledgedAt == null).sort(order),
    acknowledged: open.filter((flag) => flag.acknowledgedAt != null).sort(order),
  };
}

/**
 * What a flag is about, for its badge. One patient can have a flag of each rule open at once,
 * with the same handoff sentence, so the badge is what tells them apart.
 */
export function flagRuleLabel(rule: FlagRule): string {
  switch (rule) {
    case 'score_rise':
      return 'Score above check-in';
    case 'baseline_shift':
      return 'Change from check-in';
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

export type VitalPoint = { at: number; value: number };

/** One line of the vitals history: every sitting that gave this value, oldest first. */
export function vitalSeries(sittings: Sitting[], vital: 'heartRate' | 'breathingRate'): VitalPoint[] {
  return sittings
    .flatMap((sitting) => {
      const value = sitting.summary?.[vital].value;
      const at = sitting.endedAt ? new Date(sitting.endedAt).getTime() : Number.NaN;
      return value == null || Number.isNaN(at) ? [] : [{ at, value }];
    })
    .sort((a, b) => a.at - b.at);
}

export type SittingRow = {
  key: string;
  /** When it ended, or started if it is still running. */
  time: string;
  title: string;
  running: boolean;
  /** Rounded, without units. Null is "No reading". */
  pulse: string | null;
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
        pulse != null
          ? `${seconds}, pulse read ${percent(summary.heartRate.coverage)} of the time`
          : `${seconds}, no pulse or breathing could be read`;
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
