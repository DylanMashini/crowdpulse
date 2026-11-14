export type TileState = 'observed' | 'flag' | 'overdue' | 'no-reading';
export type Provenance = 'live' | 'recording' | 'experimental' | 'ai-draft' | 'reference';
export type ScoreValue = 0 | 1 | 2 | 3;

/** A value against the patient's own check-in baseline. `now: null` means no reading. */
export interface Trend {
  base?: number | null;
  now: number | null;
}

export interface WorklistRow {
  ticket: number;
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
  /** A sitting is running for this ticket now. */
  sittingInProgress?: boolean;
}
