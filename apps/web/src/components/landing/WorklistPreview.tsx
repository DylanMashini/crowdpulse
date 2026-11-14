import { Icon, StatusBadge, type TileState } from '@/components/ds';

interface Row {
  name: string;
  initials: string;
  reason: string;
  state: TileState;
  minutes: number;
  pulse: { from?: number; now: number };
  breathing: { from?: number; now: number };
}

/** An illustration of the waiting-room worklist. The people and numbers are made up. */
const ROWS: Row[] = [
  { name: 'Maria Alvarez', initials: 'MA', reason: 'Chest tightness', state: 'flag', minutes: 2, pulse: { from: 82, now: 108 }, breathing: { from: 16, now: 22 } },
  { name: 'Daniel Okafor', initials: 'DO', reason: 'Abdominal pain', state: 'overdue', minutes: 34, pulse: { now: 91 }, breathing: { now: 18 } },
  { name: 'Priya Raman', initials: 'PR', reason: 'Fever, three days', state: 'observed', minutes: 6, pulse: { from: 96, now: 94 }, breathing: { from: 18, now: 18 } },
  { name: 'Tom Whitfield', initials: 'TW', reason: 'Wrist injury', state: 'observed', minutes: 11, pulse: { from: 74, now: 72 }, breathing: { from: 14, now: 15 } },
];

function Trend({ from, now, unit }: { from?: number; now: number; unit: string }) {
  const moved = from != null && Math.abs(now - from) >= 5;
  return (
    <span className="lp-trend">
      {from != null && from !== now ? <span className="lp-trend-from">{from} to </span> : null}
      <span className={moved ? 'lp-trend-now lp-trend-moved' : 'lp-trend-now'}>{now}</span>
      <span className="lp-trend-unit"> {unit}</span>
    </span>
  );
}

export function WorklistPreview() {
  return (
    <div className="lp-worklist" role="img" aria-label="Example of the waiting-room worklist: four waiting patients ranked, with a trend flag on the first, whose pulse rose from 82 to 108 bpm since check-in">
      <div className="lp-worklist-head" aria-hidden="true">
        <span>Waiting room</span>
        <span className="lp-worklist-count">4 waiting, 2 need attention</span>
      </div>
      <ol className="lp-worklist-rows" aria-hidden="true">
        {ROWS.map((row, index) => (
          <li key={row.name} className={`lp-row${row.state === 'flag' ? ' lp-row-flag' : ''}`}>
            <span className="lp-row-rank">{index + 1}</span>
            <span className="lp-avatar">{row.initials}</span>
            <span className="lp-row-who">
              <span className="lp-row-name">{row.name}</span>
              <span className="lp-row-reason">{row.reason}</span>
            </span>
            <span className="lp-row-state">
              <StatusBadge state={row.state} minutes={row.minutes} />
            </span>
            <span className="lp-row-vital">
              <span className="lp-row-vital-label">Pulse</span>
              <Trend {...row.pulse} unit="bpm" />
            </span>
            <span className="lp-row-vital lp-row-breathing">
              <span className="lp-row-vital-label">Breathing</span>
              <Trend {...row.breathing} unit="per min" />
            </span>
          </li>
        ))}
      </ol>
      <div className="lp-push" aria-hidden="true">
        <span className="lp-push-icon">
          <Icon name="flag" size={18} />
        </span>
        <span>
          <span className="lp-push-title">Trend flag, Maria Alvarez</span>
          <span className="lp-push-body">
            <span>Pulse 82 bpm at check-in,</span> <span>108 bpm now (26 min later)</span>
          </span>
        </span>
        <span className="lp-push-action">Acknowledge</span>
      </div>
    </div>
  );
}
