/**
 * The evaluation figures behind the landing page. The JSON is generated from the harness's
 * outputs (eval/out, gitignored) and checked in:
 *
 *   uv run eval/run_eval.py mcd            # and ubfc: writes eval/out/<dataset>.json
 *   node apps/web/scripts/build-landing-eval.mjs
 *
 * Nothing on the page states an accuracy figure that is not read from here.
 */
import data from './eval-data.json';

export interface EvalSummary {
  recordings: number;
  failed: number;
  subjects: number;
  /** Recordings in which the engine gave at least one reading that could be paired. */
  withReading: number;
  /** One-second readings paired with the reference. */
  pairedReadings: number;
  maeBpm: number | null;
  biasBpm: number | null;
  /** Share of paired readings within 5 bpm of the reference, 0 to 1. */
  within5: number | null;
  /** Mean share of seconds with a reading, 0 to 1. */
  coverage: number | null;
  perRecordingMaeBpm: number | null;
  perRecordingWithin5: number | null;
  recordingsWithSummary: number;
  medianTimeToFirstS: number | null;
}

export interface EvalGroup extends EvalSummary {
  id: string;
  camera: string;
  cameraLabel: string;
  condition: string;
  conditionLabel: string;
}

export interface EvalDataset {
  id: string;
  title: string;
  video: string;
  reference: string;
  source: string;
  all: EvalSummary;
  groups: EvalGroup[];
}

export const evaluatedOn: string | null = data.evaluatedOn;
export const pairing: string = data.pairing;
export const datasets: EvalDataset[] = data.datasets;

export const dataset = (id: string): EvalDataset | undefined => datasets.find((d) => d.id === id);

/** One decimal, as eval/out/report.md prints it. */
export const bpm = (value: number | null): string => (value == null ? 'n/a' : value.toFixed(1));
/** Signed, one decimal, with a real minus sign. */
export const signedBpm = (value: number | null): string =>
  value == null ? 'n/a' : `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(1)}`;
export const percent = (value: number | null): string => (value == null ? 'n/a' : `${Math.round(value * 100)}%`);

/** "14 November 2026" from an ISO date. */
export function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day} ${months[month - 1]} ${year}`;
}
