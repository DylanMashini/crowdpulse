import type { Trend } from "@triagecam/contracts";

import { breathsPerMin, heartRate, minutes, minutesAgo, rate } from "../../lib/format.ts";

/** Said of a parameter whose baseline is not from the check-in sitting but from a re-check. */
export type LaterBaseline = {
  /** Whole minutes from that re-check to the latest observation; null when it is the latest observation. */
  minutesLater: number | null;
  /** Why the check-in is not the baseline: it read the parameter with lower confidence, or not at all. */
  checkIn: "lower_confidence" | "not_measured";
};

export type HandoffInput = {
  /** What to call the patient: their name, or "Patient 14" until one has been entered. */
  label: string;
  /** Baseline value against the latest observation. */
  pulse: Trend;
  breathing: Trend;
  /** Set when the pulse baseline is from a re-check; left out, it is the check-in. */
  pulseFrom?: LaterBaseline;
  breathingFrom?: LaterBaseline;
  /** Whole minutes from check-in to the latest observation; null while check-in is the only observation. */
  minutesLater: number | null;
  /** Null when the patient has never been observed. */
  minutesSinceObserved: number | null;
  minutesWaiting: number;
  latestGaveNoReading: boolean;
  /** bpm the latest sitting gave with lower confidence; such a rate is in neither `pulse` value. */
  latestLowConfidencePulse?: number | null;
};

/** One rate with its unit, from the formatters every screen uses. */
type WithUnit = (value: number) => string;

/**
 * The fixed-template sentence a nurse reads, for example "Maya Chen: pulse 82 bpm at check-in,
 * 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 3 min ago." It
 * states measured numbers and nothing else, each with its unit.
 */
export function handoffSentence(input: HandoffInput): string {
  const lowConfidence = input.latestLowConfidencePulse ?? null;
  const noReading =
    lowConfidence !== null
      ? ` The latest sitting read pulse ${heartRate(lowConfidence)} with lower confidence; repeat it.`
      : input.latestGaveNoReading
        ? " The latest sitting gave no reading."
        : "";
  if (input.minutesSinceObserved === null) {
    return `${input.label}: not yet observed, waiting ${minutes(input.minutesWaiting)}.${noReading}`;
  }

  const checkInOnly = input.minutesLater === null && !input.pulseFrom && !input.breathingFrom;
  const body = checkInOnly ? atCheckIn(input) : sinceCheckIn(input, input.minutesLater);
  return `${input.label}: ${body}. Last observed ${minutesAgo(input.minutesSinceObserved)}.${noReading}`;
}

function atCheckIn({ pulse, breathing }: HandoffInput): string {
  const values = [
    pulse.base === null ? null : `pulse ${heartRate(pulse.base)}`,
    breathing.base === null ? null : `breathing ${breathsPerMin(breathing.base)}`,
  ].filter((value) => value !== null);
  return `${values.join(", ")} at check-in`;
}

function sinceCheckIn(input: HandoffInput, minutesLater: number | null): string {
  let elapsedStated: number | null = null;
  const clause = (name: string, { base, now }: Trend, withUnit: WithUnit, from: LaterBaseline | undefined): string | null => {
    if (base === null && now === null) return null;
    if (base === null) return `${name} ${withUnit(now as number)} now, not measured at check-in`;
    if (from) {
      // The baseline is a re-check's. Never "at check-in", and never the short form, which implies it.
      const why = from.checkIn === "lower_confidence" ? "lower confidence at check-in" : "not measured at check-in";
      if (from.minutesLater === null) return `${name} ${withUnit(base)} now, ${why}`;
      if (now === null) return `${name} ${withUnit(base)} at a re-check, no reading now`;
      return `${name} ${withUnit(base)} at a re-check, ${withUnit(now)} now (${minutes(from.minutesLater)} later)`;
    }
    if (minutesLater === null) return `${name} ${withUnit(base)} at check-in`;
    if (now === null) return `${name} ${withUnit(base)} at check-in, no reading now`;
    // The short form states the unit once: "16 to 24 breaths per min".
    if (elapsedStated === minutesLater) return `${name} ${rate(base)} to ${withUnit(now)}`;
    elapsedStated = minutesLater;
    return `${name} ${withUnit(base)} at check-in, ${withUnit(now)} now (${minutes(minutesLater)} later)`;
  };
  return [clause("pulse", input.pulse, heartRate, input.pulseFrom), clause("breathing", input.breathing, breathsPerMin, input.breathingFrom)]
    .filter((part) => part !== null)
    .join("; ");
}
