import type { PatientRef } from '@triagecam/contracts';

export type TileState = 'observed' | 'flag' | 'overdue' | 'no-reading';
export type Provenance = 'live' | 'recording' | 'experimental' | 'ai-draft';
export type ScoreValue = 0 | 1 | 2 | 3;

/** A value against the patient's own baseline, normally the check-in. `now: null` means no reading that counts. */
export interface Trend {
  base?: number | null;
  now: number | null;
  /** Set when the baseline is a re-check's, not the check-in's: when that re-check ended. */
  baseAt?: string | null;
  /** A pulse the latest sitting gave with lower confidence. Shown tagged, never compared with the baseline. */
  lowConfidence?: number | null;
}

export interface WorklistRow {
  patient: PatientRef;
  /** The chief complaint from intake. */
  reason?: string | null;
  ageYears?: number | null;
  state: TileState;
  /** Whole minutes since the last observation. Null or missing: not yet observed. */
  minutes?: number | null;
  pulse?: Trend;
  breathing?: Trend;
  score?: ScoreValue | null;
  /** Missing when nothing has been measured yet. */
  source?: Provenance;
  /** Words for the source tag when the kind's own word is not exact enough, such as "Simulated". */
  sourceLabel?: string;
  /** A sitting is running for this patient now. */
  sittingInProgress?: boolean;
}
