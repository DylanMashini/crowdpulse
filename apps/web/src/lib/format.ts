import type { CaptureSource, EstimateReason, FlagRule } from '@triagecam/contracts';

/** A true minus sign, so a negative number lines up with a positive one. */
const MINUS = '\u2212';

/** A heart or breathing rate as the whole number every screen shows: 71.763824 is "72". */
export function rate(value: number): string {
  return String(Math.round(value));
}

/** "72 bpm". */
export function heartRate(value: number): string {
  return `${rate(value)} bpm`;
}

/** "16 /min", for rows and tiles. Spelled out as "breaths per min" where there is room. */
export function breathingRate(value: number): string {
  return `${rate(value)} /min`;
}

/** "16 breaths per min", for sentences and wherever there is room for the words. */
export function breathsPerMin(value: number): string {
  return `${rate(value)} breaths per min`;
}

/**
 * How far a rate has moved from its baseline, as the difference of the two whole numbers on
 * screen: "+12", "\u22124". Null when they show the same number.
 */
export function rateChange(base: number, now: number): string | null {
  const change = Math.round(now) - Math.round(base);
  if (change === 0) return null;
  return `${change > 0 ? '+' : MINUS}${Math.abs(change)}`;
}

/** A length of time in whole minutes: "under 1 min", "45 min", "1 h 12 min", "3 h". */
export function minutes(value: number): string {
  const whole = Math.round(value);
  if (whole < 1) return value > 0 ? 'under 1 min' : '0 min';
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** A length of time in whole seconds: "12 s". */
export function seconds(value: number): string {
  return `${Math.round(value)} s`;
}

/** A length of time in whole milliseconds: "42 ms". */
export function milliseconds(value: number): string {
  return `${Math.round(value)} ms`;
}

/** A mean that is not a whole number, to one decimal place: "2.3". */
export function decimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/** "3 min ago", "1 h 12 min ago". Whole minutes, as the worklist shows them. */
export function minutesAgo(value: number): string {
  const whole = Math.max(0, Math.floor(value));
  if (whole < 1) return 'just now';
  return `${minutes(whole)} ago`;
}

/** Age of something that changes by the second: "4 s ago", then minutes. */
export function secondsAgo(fromMs: number, nowMs: number): string {
  const elapsed = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (elapsed < 2) return 'just now';
  if (elapsed < 60) return `${elapsed} s ago`;
  return minutesAgo(Math.floor(elapsed / 60));
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayAndClock = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 24-hour clock time in the browser's zone: "14:32". */
export function clockTime(iso: string | number): string {
  return clock.format(new Date(iso));
}

/** "14 Nov, 14:32", for lists that span more than one day. */
export function dayTime(iso: string): string {
  return dayAndClock.format(new Date(iso));
}

/** "14:32" for a time today, "13 Nov, 04:00" for any other day, in the browser's zone. */
export function timeOrDayTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? clockTime(iso) : dayTime(iso);
}

/** A 0 to 1 share as a whole percentage: "83%". */
export function percent(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

const REASONS: Record<EstimateReason, string> = {
  warming_up: 'Collecting the first seconds of signal',
  awaiting_agreement: 'Waiting for three windows to agree',
  no_face: 'No face in view',
  face_changed: 'A different face came into view, starting again',
  exposure_adjusting: 'Camera exposure is still adjusting',
  low_quality: 'Signal quality too low',
  motion: 'Too much movement',
  gaps: 'Too many dropped frames',
  band_edge: 'Estimate is at the edge of the measurable range',
  no_chest: 'Chest not in view',
  no_frames: 'Camera frames stopped arriving',
};

export function reasonText(reason: EstimateReason | null): string | undefined {
  return reason ? REASONS[reason] : undefined;
}

const SOURCES: Record<CaptureSource, string> = {
  camera: 'Camera',
  simulated: 'Simulated',
  stub: 'Stub',
  recording: 'Recording',
};

export function sourceText(source: CaptureSource): string {
  return SOURCES[source];
}

const RULES: Record<FlagRule, string> = {
  score_rise: 'Partial score rose from check-in',
  baseline_shift: 'Moved from the check-in baseline',
  overdue: 'Overdue for a re-check',
};

export function ruleText(rule: FlagRule): string {
  return RULES[rule];
}

/** The rules one alert tripped, as one phrase: "Partial score rose from check-in, moved from the check-in baseline". */
export function rulesText(rules: readonly FlagRule[]): string {
  return rules.map((rule, index) => (index === 0 ? RULES[rule] : RULES[rule].charAt(0).toLowerCase() + RULES[rule].slice(1))).join(', ');
}

/** Whole years since a YYYY-MM-DD date of birth, in the browser's zone. Null when it is not known. */
export function ageInYears(dateOfBirth: string | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [year = 0, month = 1, day = 1] = dateOfBirth.split('-').map(Number);
  const hadBirthday = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  const age = now.getFullYear() - year - (hadBirthday ? 0 : 1);
  // A date in the future has no age to show.
  return age < 0 ? null : age;
}

/** An age in whole years: "34 y". */
export function years(age: number): string {
  return `${Math.floor(age)} y`;
}

/** "34 y", or null when the date of birth is not known. */
export function ageText(dateOfBirth: string | null): string | null {
  const age = ageInYears(dateOfBirth);
  return age === null ? null : years(age);
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A YYYY-MM-DD calendar date as "18 Apr 1991". */
export function calendarDate(date: string): string {
  return longDate.format(new Date(`${date}T00:00:00Z`));
}
