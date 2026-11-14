import type { Trend } from "@triagecam/contracts";

import { breathsPerMin, heartRate, minutes, minutesAgo, rate } from "../../lib/format.ts";

export type HandoffInput = {
  /** What to call the patient: their name, or "Patient 14" until one has been entered. */
  label: string;
  /** Check-in value against the latest observation. */
  pulse: Trend;
  breathing: Trend;
  /** Whole minutes from check-in to the latest observation; null while check-in is the only observation. */
  minutesLater: number | null;
  /** Null when the patient has never been observed. */
  minutesSinceObserved: number | null;
  minutesWaiting: number;
  latestGaveNoReading: boolean;
};

/** One rate with its unit, from the formatters every screen uses. */
type WithUnit = (value: number) => string;

/**
 * The fixed-template sentence a nurse reads, for example "Maya Chen: pulse 82 bpm at check-in,
 * 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 3 min ago." It
 * states measured numbers and nothing else, each with its unit.
 */
export function handoffSentence(input: HandoffInput): string {
  const noReading = input.latestGaveNoReading ? " The latest sitting gave no reading." : "";
  if (input.minutesSinceObserved === null) {
    return `${input.label}: not yet observed, waiting ${minutes(input.minutesWaiting)}.${noReading}`;
  }

  const body = input.minutesLater === null ? atCheckIn(input) : sinceCheckIn(input, input.minutesLater);
  return `${input.label}: ${body}. Last observed ${minutesAgo(input.minutesSinceObserved)}.${noReading}`;
}

function atCheckIn({ pulse, breathing }: HandoffInput): string {
  const values = [
    pulse.base === null ? null : `pulse ${heartRate(pulse.base)}`,
    breathing.base === null ? null : `breathing ${breathsPerMin(breathing.base)}`,
  ].filter((value) => value !== null);
  return `${values.join(", ")} at check-in`;
}

function sinceCheckIn({ pulse, breathing }: HandoffInput, minutesLater: number): string {
  let elapsedStated = false;
  const clause = (name: string, { base, now }: Trend, withUnit: WithUnit): string | null => {
    if (base === null && now === null) return null;
    if (base === null) return `${name} ${withUnit(now as number)} now, not measured at check-in`;
    if (now === null) return `${name} ${withUnit(base)} at check-in, no reading now`;
    // The short form states the unit once: "16 to 24 breaths per min".
    if (elapsedStated) return `${name} ${rate(base)} to ${withUnit(now)}`;
    elapsedStated = true;
    return `${name} ${withUnit(base)} at check-in, ${withUnit(now)} now (${minutes(minutesLater)} later)`;
  };
  return [clause("pulse", pulse, heartRate), clause("breathing", breathing, breathsPerMin)]
    .filter((part) => part !== null)
    .join("; ");
}
