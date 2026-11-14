'use client';

import { useState, type MouseEvent } from 'react';

import { cx } from '@/lib/cx';

import { tableCell, tableHeadCell } from './WorklistTable';

export interface ReferenceChartProps {
  /** One value per second of the sitting, in bpm. Null where there was no reading. */
  estimate: Array<number | null>;
  reference: Array<number | null>;
  referenceName?: string;
  title?: string;
  width?: number;
  height?: number;
  /** The x axis covers at least this many seconds, so a running sitting draws left to right instead of rescaling. */
  minSeconds?: number;
  className?: string;
}

const MARGIN = { top: 16, right: 84, bottom: 28, left: 40 };

function lastValue(values: Array<number | null>): { index: number; value: number } | null {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (value != null) return { index, value };
  }
  return null;
}

const keyLine = 'mr-[6px] inline-block h-0 w-[18px] align-middle border-t-2';

/**
 * Camera estimate against the reference device over one sitting, with the running error.
 * One y axis in bpm. Gaps stay gaps: nothing is drawn across a second without a reading.
 */
export function ReferenceChart({
  estimate,
  reference,
  referenceName = 'Chest strap',
  title = 'Heart rate, camera estimate against reference',
  width = 640,
  height = 240,
  minSeconds = 0,
  className,
}: ReferenceChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const count = Math.max(estimate.length, reference.length);
  /** Seconds on the x axis. `count` is how many of them have data. */
  const span = Math.max(count, minSeconds + 1);
  const values = [...estimate, ...reference].filter((value): value is number => value != null);
  const low = values.length ? Math.floor((Math.min(...values) - 4) / 10) * 10 : 60;
  const high = values.length ? Math.ceil((Math.max(...values) + 4) / 10) * 10 : 100;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + plotWidth * (span > 1 ? index / (span - 1) : 0);
  const y = (value: number) => MARGIN.top + plotHeight * (1 - (value - low) / (high - low));

  const path = (series: Array<number | null>) => {
    let d = '';
    let penDown = false;
    series.forEach((value, index) => {
      if (value == null) {
        penDown = false;
        return;
      }
      d += `${penDown ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
      penDown = true;
    });
    return d;
  };

  const errors: number[] = [];
  for (let index = 0; index < count; index++) {
    const a = estimate[index];
    const b = reference[index];
    if (a != null && b != null) errors.push(Math.abs(a - b));
  }
  const meanError = errors.length ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null;
  const within = errors.length ? Math.round((100 * errors.filter((error) => error <= 5).length) / errors.length) : null;

  const yTicks: number[] = [];
  for (let tick = low; tick <= high; tick += 10) yTicks.push(tick);
  const xStep = span > 300 ? 60 : span > 120 ? 30 : 10;
  const xTicks: number[] = [];
  for (let second = 0; second < span; second += xStep) xTicks.push(second);
  const tableSeconds = xTicks.filter((second) => second < count);
  if (count > 0 && tableSeconds.at(-1) !== count - 1) tableSeconds.push(count - 1);

  const lastEstimate = lastValue(estimate);
  const lastReference = lastValue(reference);
  // Both end labels sit in the right margin. When they would overlap, push them apart, the
  // higher value upward.
  const labelX = width - MARGIN.right + 8;
  const nudge =
    lastEstimate && lastReference && Math.abs(y(lastEstimate.value) - y(lastReference.value)) < 16
      ? lastEstimate.value >= lastReference.value
        ? [-9, 9]
        : [9, -9]
      : [0, 0];

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    if (count < 1) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    const index = Math.round(((px - MARGIN.left) / plotWidth) * (span - 1));
    setHover(Math.max(0, Math.min(count - 1, index)));
  };

  const hoverEstimate = hover != null ? estimate[hover] : null;
  const hoverReference = hover != null ? reference[hover] : null;

  return (
    <figure className={cx('w-full rounded-lg border border-line bg-surface-raised p-4', className)}>
      <figcaption className="mb-3 flex flex-wrap justify-between gap-4">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="type-caption text-ink-muted tabular-nums">
            {meanError != null
              ? `Mean absolute error ${meanError.toFixed(1)} bpm over ${errors.length} paired seconds. ${within}% within 5 bpm.`
              : 'Waiting for both signals'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span className="inline-flex items-center">
            <i className={cx(keyLine, 'border-series-estimate')} />
            Camera estimate
          </span>
          <span className="inline-flex items-center">
            <i className={cx(keyLine, 'border-dashed border-series-reference')} />
            {referenceName}
          </span>
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable(!asTable)}
            className="cursor-pointer text-[13px] font-medium text-signal underline underline-offset-[3px]"
          >
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
      </figcaption>

      {values.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 type-caption text-ink-muted">
          No readings in this sitting yet. The lines start when the camera or the reference device gives its first value.
        </p>
      ) : asTable ? (
        <div className="max-h-[260px] overflow-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[15px] tabular-nums">
            <thead>
              <tr>
                <th scope="col" className={tableHeadCell}>
                  Second
                </th>
                <th scope="col" className={tableHeadCell}>
                  Camera, bpm
                </th>
                <th scope="col" className={tableHeadCell}>
                  Reference, bpm
                </th>
                <th scope="col" className={tableHeadCell}>
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {tableSeconds.map((second) => {
                const a = estimate[second];
                const b = reference[second];
                return (
                  <tr key={second}>
                    <td className={cx(tableCell, 'py-2')}>{second}</td>
                    <td className={cx(tableCell, 'py-2')}>{a ?? 'No reading'}</td>
                    <td className={cx(tableCell, 'py-2')}>{b ?? 'No reading'}</td>
                    <td className={cx(tableCell, 'py-2')}>{a != null && b != null ? `${a - b > 0 ? '+' : a - b < 0 ? '−' : ''}${Math.abs(a - b)}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Line chart of camera estimate and reference heart rate over the sitting"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="block h-auto w-full"
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="stroke-line" strokeWidth={1} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
                <text className="fill-ink-muted font-sans text-[12px] tabular-nums" x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            {xTicks.map((second) => (
              <text key={second} className="fill-ink-muted font-sans text-[12px] tabular-nums" x={x(second)} y={height - 8} textAnchor="middle">
                {second} s
              </text>
            ))}
            <path className="fill-none stroke-series-reference" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" d={path(reference)} />
            <path className="fill-none stroke-series-estimate" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" d={path(estimate)} />
            {lastReference ? (
              <text
                className="fill-ink-muted font-sans text-[12px] font-medium"
                x={labelX}
                y={y(lastReference.value) + 4 + (nudge[1] ?? 0)}
              >
                Reference {lastReference.value}
              </text>
            ) : null}
            {lastEstimate ? (
              <text
                className="fill-ink font-sans text-[12px] font-medium"
                x={labelX}
                y={y(lastEstimate.value) + 4 + (nudge[0] ?? 0)}
              >
                Camera {lastEstimate.value}
              </text>
            ) : null}
            {hover != null ? (
              <g>
                <line className="stroke-line-strong" strokeWidth={1} x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={height - MARGIN.bottom} />
                {hoverReference != null ? (
                  <circle className="fill-series-reference stroke-surface-raised" strokeWidth={2} cx={x(hover)} cy={y(hoverReference)} r={4} />
                ) : null}
                {hoverEstimate != null ? (
                  <circle className="fill-series-estimate stroke-surface-raised" strokeWidth={2} cx={x(hover)} cy={y(hoverEstimate)} r={4} />
                ) : null}
              </g>
            ) : null}
          </svg>
          {hover != null ? (
            <div
              className={cx(
                'pointer-events-none absolute top-[4px] rounded-md border border-line bg-surface-raised px-3 py-2 text-[13px] leading-[20px] whitespace-nowrap shadow-overlay',
                x(hover) > width * 0.6 ? 'translate-x-[calc(-100%-12px)]' : 'translate-x-[12px]',
              )}
              style={{ left: `${(x(hover) / width) * 100}%` }}
            >
              <div className="text-ink-muted">{hover} s</div>
              <div>
                <i className={cx(keyLine, 'border-series-estimate')} />
                Camera <b className="font-mono font-semibold">{hoverEstimate ?? 'No reading'}</b>
              </div>
              <div>
                <i className={cx(keyLine, 'border-dashed border-series-reference')} />
                Reference <b className="font-mono font-semibold">{hoverReference ?? 'No reading'}</b>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}
