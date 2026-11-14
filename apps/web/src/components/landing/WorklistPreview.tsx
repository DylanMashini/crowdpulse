import { Icon, ScoreChip, StatusBadge, type ScoreValue, type Severity, type TileState } from '@/components/ds';

interface Row {
  name: string;
  reason: string;
  state: TileState;
  severity?: Severity;
  score: ScoreValue;
  pulse: { from?: number; now: number };
  breathing: { from?: number; now: number };
}

/**
 * An illustration of the waiting-room worklist. The people and numbers are made up. The scores
 * follow the product's own bands (pulse 91 to 110 scores 1, breathing 21 to 24 scores 2), so the
 * first row is a score that rose from 0 to 2: an urgent trend flag.
 */
const ROWS: Row[] = [
  { name: 'Maria Alvarez', reason: 'Chest tightness', state: 'flag', severity: 'urgent', score: 2, pulse: { from: 82, now: 108 }, breathing: { from: 16, now: 22 } },
  { name: 'Daniel Okafor', reason: 'Abdominal pain', state: 'overdue', score: 1, pulse: { now: 91 }, breathing: { now: 18 } },
  { name: 'Priya Raman', reason: 'Fever, three days', state: 'observed', score: 1, pulse: { from: 96, now: 94 }, breathing: { from: 18, now: 18 } },
  { name: 'Tom Whitfield', reason: 'Wrist injury', state: 'observed', score: 0, pulse: { from: 74, now: 72 }, breathing: { from: 14, now: 15 } },
];

function Value({ from, now, severity, className }: { from?: number; now: number; severity?: Severity; className?: string }) {
  const change = from == null ? null : now - from;
  return (
    <span className={`lp-row-value ${className ?? ''}`}>
      <span className="lp-row-now">{now}</span>
      <span className={`lp-row-delta${change && severity ? ' lp-row-delta-urgent' : ''}`}>{change == null ? '' : change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0'}</span>
    </span>
  );
}

export function WorklistPreview() {
  return (
    <div className="lp-worklist" role="img" aria-label="Example of the waiting-room worklist: four waiting patients ranked, with a trend flag on the first, whose pulse rose from 82 to 108 bpm since check-in">
      <div className="lp-worklist-window" aria-hidden="true">
        <div className="lp-worklist-cap">
          <span>Waiting room</span>
          <span>Example patients</span>
        </div>
        <div className="lp-row lp-row-head">
          <span>Patient</span>
          <span>State</span>
          <span className="lp-row-score">Score</span>
          <span className="lp-row-value">Pulse, bpm</span>
          <span className="lp-row-value lp-row-breathing">Breathing, /min</span>
        </div>
        <ol>
          {ROWS.map((row) => (
            <li key={row.name} className={`lp-row${row.severity === 'urgent' ? ' lp-row-urgent' : ''}${row.state === 'observed' ? ' lp-row-quiet' : ''}`}>
              <span className="lp-row-who">
                <span className="lp-row-name">{row.name}</span>
                <span className="lp-row-reason">{row.reason}</span>
              </span>
              <span>
                <StatusBadge state={row.state} severity={row.severity} minutes={0} brief />
              </span>
              <span className="lp-row-score">
                <ScoreChip score={row.score} caption={false} />
              </span>
              <Value {...row.pulse} severity={row.severity} />
              <Value {...row.breathing} severity={row.severity} className="lp-row-breathing" />
            </li>
          ))}
        </ol>
      </div>
      <div className="lp-push" aria-hidden="true">
        <span className="lp-push-title">
          <Icon name="flag" size={14} />
          Trend flag, Maria Alvarez
        </span>
        <span className="lp-push-body">Pulse 82 bpm at check-in, 108 bpm now (26 min later)</span>
      </div>
    </div>
  );
}
