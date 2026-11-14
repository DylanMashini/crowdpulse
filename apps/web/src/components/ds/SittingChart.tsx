'use client';

import { useState, type MouseEvent } from 'react';

import { cx } from '@/lib/cx';

import { Button } from './Button';
import { tableCell, tableHeadCell } from './TableFrame';

export interface SittingChartProps {
  /** One value per second of the sitting, in bpm. Null where there was no reading. */
  values: Array<number | null>;
  title?: string;
  width?: number;
  height?: number;
  /** The x axis covers at least this many seconds, so a running sitting draws left to right instead of rescaling. */
  minSeconds?: number;
  className?: string;
}

const MARGIN = { top: 16, right: 64, bottom: 28, left: 32 };

function lastValue(values: Array<number | null>): { index: number; value: number } | null {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (value != null) return { index, value };
  }
  return null;
}

/**
 * The camera's heart rate over one sitting, second by second. Gaps stay gaps: nothing is
 * drawn across a second without a reading.
 */
export function SittingChart({ values, title = 'Heart rate over the sitting', width = 640, height = 240, minSeconds = 0, className }: SittingChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const count = values.length;
  /** Seconds on the x axis. `count` is how many of them have data. */
  const span = Math.max(count, minSeconds + 1);
  const present = values.filter((value): value is number => value != null);
  const low = present.length ? Math.floor((Math.min(...present) - 4) / 10) * 10 : 60;
  const high = present.length ? Math.ceil((Math.max(...present) + 4) / 10) * 10 : 100;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + plotWidth * (span > 1 ? index / (span - 1) : 0);
  const y = (value: number) => MARGIN.top + plotHeight * (1 - (value - low) / (high - low));

  let path = '';
  let penDown = false;
  values.forEach((value, index) => {
    if (value == null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    penDown = true;
  });

  const yTicks: number[] = [];
  for (let tick = low; tick <= high; tick += 10) yTicks.push(tick);
  const xStep = span > 300 ? 60 : span > 120 ? 30 : 10;
  const xTicks: number[] = [];
  for (let second = 0; second < span; second += xStep) xTicks.push(second);
  const tableSeconds = xTicks.filter((second) => second < count);
  if (count > 0 && tableSeconds.at(-1) !== count - 1) tableSeconds.push(count - 1);

  const last = lastValue(values);

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    if (count < 1) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - box.left) * (width / box.width);
    const index = Math.round(((px - MARGIN.left) / plotWidth) * (span - 1));
    setHover(Math.max(0, Math.min(count - 1, index)));
  };

  const hoverValue = hover != null ? values[hover] : null;

  return (
    <figure className={cx('w-full', className)}>
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <div className="type-subheading text-ink">{title}</div>
          <div className="type-caption text-ink-faint tabular-nums">
            {present.length ? `${present.length} of ${count} seconds gave a reading` : 'Waiting for the first reading'}
          </div>
        </div>
        <Button variant="quiet" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show chart' : 'Show table'}
        </Button>
      </figcaption>

      {present.length === 0 ? (
        <p className="border-t border-line py-4 type-dense text-ink-muted">
          No readings in this sitting yet. The line starts with the first heart rate from the camera.
        </p>
      ) : asTable ? (
        <div className="max-h-[264px] overflow-auto border-t border-line">
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr>
                <th scope="col" className={cx(tableHeadCell, 'first:pl-[10px]')}>
                  Second
                </th>
                <th scope="col" className={tableHeadCell}>
                  Heart rate
                </th>
              </tr>
            </thead>
            <tbody>
              {tableSeconds.map((second) => (
                <tr key={second}>
                  <td className={cx(tableCell, 'h-control-md first:pl-[10px]')}>{second} s</td>
                  <td className={cx(tableCell, 'h-control-md')}>{values[second] == null ? 'No reading' : `${values[second]} bpm`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Line chart of heart rate in beats per minute over the sitting"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="block h-auto w-full"
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="stroke-line" strokeWidth={1} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
                <text className="fill-ink-faint font-sans text-[11px] tabular-nums" x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            {xTicks.map((second) => (
              <text key={second} className="fill-ink-faint font-sans text-[11px] tabular-nums" x={x(second)} y={height - 8} textAnchor="middle">
                {second} s
              </text>
            ))}
            <path className="fill-none stroke-series-estimate" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" d={path} />
            {last ? (
              <>
                <circle className="fill-series-estimate stroke-surface-1" strokeWidth={2} cx={x(last.index)} cy={y(last.value)} r={4} />
                <text className="fill-ink font-mono text-[12px] tabular-nums" x={x(last.index) + 10} y={y(last.value) + 4}>
                  {last.value} bpm
                </text>
              </>
            ) : null}
            {hover != null ? (
              <g>
                <line className="stroke-line-strong" strokeWidth={1} x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={height - MARGIN.bottom} />
                {hoverValue != null ? (
                  <circle className="fill-series-estimate stroke-surface-1" strokeWidth={2} cx={x(hover)} cy={y(hoverValue)} r={4} />
                ) : null}
              </g>
            ) : null}
          </svg>
          {hover != null ? (
            <div
              className={cx(
                'pointer-events-none absolute top-1 rounded-md border border-line-strong bg-surface-3 px-3 py-2 type-dense whitespace-nowrap shadow-overlay',
                x(hover) > width * 0.6 ? 'translate-x-[calc(-100%-12px)]' : 'translate-x-[12px]',
              )}
              style={{ left: `${(x(hover) / width) * 100}%` }}
            >
              <div className="type-caption text-ink-muted tabular-nums">{hover} s</div>
              <div>{hoverValue == null ? 'No reading' : <span className="type-readout-sm text-ink">{hoverValue} bpm</span>}</div>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}
