'use client';

import { useState } from 'react';

import { Segmented } from '@/components/ui/Segmented';

import { bpm, percent, type EvalGroup } from './eval-data';

type Metric = 'mae' | 'within5';

const METRICS: Record<Metric, { label: string; title: string; note: string; value: (g: EvalGroup) => number | null; text: (v: number | null) => string; max: (groups: EvalGroup[]) => number; ticks: (max: number) => number[]; tick: (v: number) => string }> = {
  mae: {
    label: 'Mean error',
    title: 'Mean absolute error, bpm',
    note: 'Shorter is better',
    value: (g) => g.maeBpm,
    text: (v) => `${bpm(v)} bpm`,
    max: (groups) => Math.ceil(Math.max(...groups.map((g) => g.maeBpm ?? 0)) / 5) * 5,
    ticks: (max) => Array.from({ length: max / 5 + 1 }, (_, i) => i * 5),
    tick: (v) => String(v),
  },
  within5: {
    label: 'Within 5 bpm',
    title: 'Readings within 5 bpm of the reference',
    note: 'Longer is better',
    value: (g) => g.within5,
    text: (v) => percent(v),
    max: () => 1,
    ticks: () => [0, 0.25, 0.5, 0.75, 1],
    tick: (v) => `${v * 100}%`,
  },
};

/**
 * Camera position against accuracy, one panel per condition on a shared scale. The front-facing
 * camera, the one the station uses, carries the accent; the count behind every bar is printed.
 */
export function AccuracyChart({ groups }: { groups: EvalGroup[] }) {
  const [metric, setMetric] = useState<Metric>('mae');
  const spec = METRICS[metric];
  const max = spec.max(groups);
  const ticks = spec.ticks(max);
  const conditions = [...new Set(groups.map((g) => g.condition))];

  return (
    <div className="lp-chart">
      <div className="lp-chart-head">
        <div>
          <h3 className="lp-chart-title">{spec.title}, by camera position</h3>
          <p className="lp-chart-note">{spec.note}</p>
        </div>
        <Segmented
          label="Measure"
          value={metric}
          onChange={setMetric}
          options={(Object.keys(METRICS) as Metric[]).map((value) => ({ value, label: METRICS[value].label }))}
        />
      </div>

      <div className="lp-chart-panels">
        {conditions.map((condition) => {
          const rows = groups.filter((g) => g.condition === condition);
          return (
            <section key={condition} className="lp-chart-panel" aria-label={rows[0]?.conditionLabel}>
              <h4 className="lp-chart-panel-title">{rows[0]?.conditionLabel}</h4>
              <div className="lp-bars">
                <div className="lp-bars-grid" aria-hidden="true">
                  {ticks.map((tick) => (
                    <span key={tick} style={{ left: `${(tick / max) * 100}%` }} />
                  ))}
                </div>
                {rows.map((row) => {
                  const value = spec.value(row);
                  return (
                    <div key={row.id} className="lp-bar-row">
                      <div className="lp-bar-label">
                        <span className="lp-bar-name">{row.cameraLabel}</span>
                        <span className="lp-bar-n">
                          {row.pairedReadings} readings, {row.withReading} of {row.recordings} recordings
                        </span>
                      </div>
                      <div className="lp-bar-track">
                        <span
                          className={row.camera === 'front' ? 'lp-bar lp-bar-front' : 'lp-bar'}
                          style={{ width: `${((value ?? 0) / max) * 100}%` }}
                        />
                        <span className="lp-bar-value">{spec.text(value)}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="lp-bars-axis" aria-hidden="true">
                  {ticks.map((tick) => (
                    <span key={tick} style={{ left: `${(tick / max) * 100}%` }}>
                      {spec.tick(tick)}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
