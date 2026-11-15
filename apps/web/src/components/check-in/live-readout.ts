import {
  EXPOSURE_STUCK,
  EXPOSURE_STUCK_AFTER_SECONDS,
  HELD_READING_CLEARS_AFTER_ABSENT_MS,
  HELD_READING_FOR_MS,
  SHOWN_NOT_RECORDED,
  heldReadingAge,
  isAbsentReason,
  type Estimate,
  type StoredReading,
} from '@triagecam/contracts';

import { exposureIsStuck, rate, reasonText, secondsAgo } from '../../lib/format.ts';

// What one vital's box shows while a sitting runs. Kept apart from the component so the rule
// can be read, and tested, in one place.

/** No reading from the phone for this long: the phone has gone quiet. */
export const SILENT_AFTER_MS = 3000;

export interface LiveReadout {
  state: 'valid' | 'held' | 'settling' | 'none';
  /** Already rounded for the screen. Set for `valid` and `held`. */
  value?: string;
  /** How long ago the newest reading arrived: under a `valid` value. */
  age?: string;
  /** How old a `held` value is, once it is no longer fresh: "8 s ago". */
  heldAge?: string;
  /** Why there is no fresh value. */
  reason?: string;
  coverage: number;
}

/**
 * The box for one vital, from every reading of the sitting so far (in time order). Once a
 * reading has carried a value, the box holds the latest one for the rest of the sitting, with
 * its age once it is no longer fresh. A value is let go once nobody has been in the picture for
 * `HELD_READING_CLEARS_AFTER_ABSENT_MS`. It works from the readings alone, so a page that is
 * reloaded during a sitting shows the same box again.
 */
export function liveReadout(readings: StoredReading[], pick: (reading: StoredReading) => Estimate, serverNow: number): LiveReadout {
  const latest = readings.at(-1);
  if (!latest) return { state: 'settling', reason: 'Waiting for the first reading from the phone', coverage: 0 };

  const estimate = pick(latest);
  const at = new Date(latest.t).getTime();
  const silence = serverNow - at;
  const silent = silence > SILENT_AFTER_MS;
  if (!silent && estimate.state === 'valid' && estimate.value != null) {
    return { state: 'valid', value: rate(estimate.value), age: secondsAgo(at, serverNow), coverage: estimate.coverage };
  }

  // Exposure that has not settled for seconds on end will not: say what to do about it.
  const stuck = exposureIsStuck(readings.slice(-EXPOSURE_STUCK_AFTER_SECONDS).map((reading) => pick(reading).reason));
  const reason = silent
    ? `No readings from the phone since ${secondsAgo(at, serverNow)}`
    : stuck
      ? EXPOSURE_STUCK
      : reasonText(estimate.reason);

  const lastIndex = readings.findLastIndex((reading) => pick(reading).value != null);
  const last = readings[lastIndex];
  const lastValue = last ? pick(last).value : null;
  if (last && lastValue != null && !leftThePicture(readings, lastIndex, pick)) {
    // Measured on the phone's own clock between two of its readings, so a phone whose clock
    // is off does not age every value; the server's clock only adds the time since it went quiet.
    const heldMs = Math.max(0, at - new Date(last.t).getTime()) + (silent ? silence : 0);
    if (heldMs <= HELD_READING_FOR_MS) {
      return { state: 'held', value: rate(lastValue), heldAge: heldReadingAge(heldMs) ?? undefined, reason, coverage: estimate.coverage };
    }
  }
  return { state: !silent && estimate.state === 'settling' ? 'settling' : 'none', reason, coverage: estimate.coverage };
}

/**
 * Whether, since the reading at `from`, the vital has said "no face" or "no chest" without a
 * break for long enough that its value belongs to somebody who is no longer there. A dropout
 * for any other reason, or a shorter one, does not count: holding through those is the point.
 */
function leftThePicture(readings: StoredReading[], from: number, pick: (reading: StoredReading) => Estimate): boolean {
  let absentSince: number | null = null;
  for (const reading of readings.slice(from + 1)) {
    if (!isAbsentReason(pick(reading).reason)) {
      absentSince = null;
      continue;
    }
    const t = new Date(reading.t).getTime();
    absentSince ??= t;
    if (t - absentSince >= HELD_READING_CLEARS_AFTER_ABSENT_MS) return true;
  }
  return false;
}

/**
 * Why a finished sitting has no value for a vital. The live display shows a value sooner than
 * the record accepts one, so a sitting can end with nothing recorded after a number was on
 * screen: that is said, and the shown value is never used in its place.
 */
export function noSummaryReason(readings: StoredReading[], pick: (reading: StoredReading) => Estimate): string {
  return readings.some((reading) => pick(reading).value != null) ? SHOWN_NOT_RECORDED : 'No reading was accepted in this sitting';
}

/**
 * Whether a vital's box shows its coverage meter. Coverage counts recorded seconds only, so
 * while a sitting runs and none is recorded yet the meter would read 0% under a shown value.
 */
export function coverageIsShown(live: boolean, coverage: number): boolean {
  return !live || coverage > 0;
}
