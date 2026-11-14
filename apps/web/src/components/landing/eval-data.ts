/**
 * The evaluation figures behind the landing page. The JSON is generated from the harness's
 * outputs (eval/out, gitignored) and checked in:
 *
 *   uv run eval/run_eval.py --rescore      # writes eval/out/ubfc.json and eval/out/report.md
 *   node apps/web/scripts/build-landing-eval.mjs
 *
 * Nothing on the page states an accuracy figure that is not read from here. The only published
 * dataset is UBFC-rPPG and the only published set is its held-out set: the script refuses
 * anything else. Wherever a figure is shown, `provenance` (dataset, set, n, date) goes beside it.
 */
import data from './eval-data.json';

/** Pooled figures over scored recordings of one set. */
export interface EvalSummary {
  subjects: number;
  recordings: number;
  /** Recordings in which the engine gave at least one reading that could be paired. */
  withReading: number;
  /** One-second readings paired with the reference. */
  pairedReadings: number;
  maeBpm: number | null;
  biasBpm: number | null;
  /** Share of paired readings within 5 bpm of the reference, 0 to 1. */
  within5: number | null;
  /**
   * In each recording, the share of one-second ticks, warm-up included, in which the engine gave
   * a heart rate; then the mean over recordings, each counting equally. 0 to 1.
   */
  coverage: number | null;
  medianTimeToFirstS: number | null;
}

export interface EvalDataset {
  id: string;
  title: string;
  video: string;
  reference: string;
  source: string;
  /** Subjects in the published dataset, both sets together. */
  totalSubjects: number;
}

export const evaluatedOn: string = data.evaluatedOn;
export const pairing: string = data.pairing;
export const dataset: EvalDataset = data.dataset;
/** How the dataset's subjects were divided. Only the held-out set is published. */
export const split: { set: string; seed: number; heldOutSubjects: number; tuningSubjects: number } = data.split;
/** The published figures: the whole held-out set. */
export const heldOut: EvalSummary = data.heldOut;
/** Held-out subjects the engine had been checked against before the split was drawn. */
export const seenInDevelopment: number = data.seenInDevelopment;
/** The held-out figures without those subjects, for the disclosure. Null when there are none. */
export const heldOutWithoutSeen: EvalSummary | null = data.heldOutWithoutSeen;
/** Held-out reference files by the independent copy they were checked against. */
export const referenceChecks: { authorsFile: number; otherCopies: number } = data.referenceChecks;

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

const readings = (s: EvalSummary) => `${s.pairedReadings.toLocaleString('en-US')} one-second readings`;

/** Dataset, set, n and date: the line that goes beside every published figure. */
export const provenance = (s: EvalSummary = heldOut): string =>
  `${dataset.title} public dataset, held-out set: ${s.subjects} subjects, ${readings(s)}, evaluated ${longDate(evaluatedOn) ?? evaluatedOn}`;
