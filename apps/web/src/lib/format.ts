import type { CaptureSource, EstimateReason, FlagRule } from '@triagecam/contracts';

/** "3 min ago", "1 h 12 min ago". Whole minutes, as the worklist shows them. */
export function minutesAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${rest ? `${rest} min ` : ''}ago`;
}

/** Age of something that changes by the second: "4 s ago", then minutes. */
export function secondsAgo(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  return minutesAgo(Math.floor(seconds / 60));
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

/** A 0 to 1 share as a whole percentage. */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/** A signed difference with a true minus sign: "+1.2", "−0.8". */
export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value > 0 ? '+' : '−'}${text}`;
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

/** Whole years since a YYYY-MM-DD date of birth, in the browser's zone. Null when it is not known. */
export function ageInYears(dateOfBirth: string | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [year = 0, month = 1, day = 1] = dateOfBirth.split('-').map(Number);
  const hadBirthday = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  return Math.max(0, now.getFullYear() - year - (hadBirthday ? 0 : 1));
}

/** "34 y", or null when the date of birth is not known. */
export function ageText(dateOfBirth: string | null): string | null {
  const age = ageInYears(dateOfBirth);
  return age === null ? null : `${age} y`;
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A YYYY-MM-DD calendar date as "18 Apr 1991". */
export function calendarDate(date: string): string {
  return longDate.format(new Date(`${date}T00:00:00Z`));
}
