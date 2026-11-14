import type { PatientRef } from '@triagecam/contracts';

export type TileState = 'observed' | 'flag' | 'overdue' | 'no-reading';
export type Provenance = 'live' | 'recording' | 'experimental' | 'ai-draft';
export type ScoreValue = 0 | 1 | 2 | 3;
/** How a flagged patient is drawn. Presentation only: it is read off the state, the score and the open flags' rules. */
export type Severity = 'watch' | 'urgent';

/** A value against the patient's own check-in baseline. `now: null` means no reading. */
export interface Trend {
  base?: number | null;
  now: number | null;
}

export interface WorklistRow {
  patient: PatientRef;
  /** The chief complaint from intake. */
  reason?: string | null;
  ageYears?: number | null;
  state: TileState;
  /** Set when the row carries colour: amber for watch, red for urgent. */
  severity?: Severity | null;
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
