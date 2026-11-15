import {
  EXPOSURE_STUCK,
  EXPOSURE_STUCK_AFTER_SECONDS,
  HELD_READING_FOR_MS,
  heldReadingAge,
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
 * its age once it is no longer fresh. It works from the readings alone, so a page that is
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

  const last = readings.findLast((reading) => pick(reading).value != null);
  const lastValue = last ? pick(last).value : null;
  if (last && lastValue != null) {
    // Measured on the phone's own clock between two of its readings, so a phone whose clock
    // is off does not age every value; the server's clock only adds the time since it went quiet.
    const heldMs = Math.max(0, at - new Date(last.t).getTime()) + (silent ? silence : 0);
    if (heldMs <= HELD_READING_FOR_MS) {
      return { state: 'held', value: rate(lastValue), heldAge: heldReadingAge(heldMs) ?? undefined, reason, coverage: estimate.coverage };
    }
  }
  return { state: !silent && estimate.state === 'settling' ? 'settling' : 'none', reason, coverage: estimate.coverage };
}
