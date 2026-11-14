'use client';

import type { RateDistribution } from '@triagecam/contracts';
import { useState } from 'react';

import { cx } from '@/lib/cx';
import { rate } from '@/lib/format';

const WIDTH = 520;
const HEIGHT = 208;
const MARGIN = { top: 34, right: 8, bottom: 30, left: 8 };
const BAR = 24;

export interface RateHistogramProps {
  title: string;
  distribution: RateDistribution;
  /** "bpm", "breaths per min". */
  unit: string;
  /** The range that scores 0 on the partial NEWS2 chart, drawn as a band behind the bars. */
  usual: { from: number; to: number };
}

const sittings = (count: number) => `${count} ${count === 1 ? 'sitting' : 'sittings'}`;

/**
 * How one rate was spread over the period's sittings: a column per bin, the count on its cap,
 * and the range that scores 0 as a band behind them. The same numbers are in a table for
 * screen readers.
 */
export function RateHistogram({ title, distribution, unit, usual }: RateHistogramProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { bins } = distribution;
  const summary =
    distribution.median == null || distribution.lowest == null || distribution.highest == null
      ? null
      : `Median ${rate(distribution.median)} ${unit}, from ${rate(distribution.lowest)} to ${rate(distribution.highest)}, over ${sittings(distribution.sittings)}`;

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const plotHeight = plotBottom - MARGIN.top;
  const slot = bins.length ? plotWidth / bins.length : plotWidth;
  const tallest = Math.max(1, ...bins.map((bin) => bin.sittings));
  const left = (index: number) => MARGIN.left + index * slot;
  const barHeight = (count: number) => (count === 0 ? 0 : Math.max(4, (plotHeight - 18) * (count / tallest)));
  // Every bin is labelled while the labels have room; past that, every other one.
  const labelEvery = slot >= 58 ? 1 : 2;

  const usualBins = bins.flatMap((bin, index) => (bin.from >= usual.from && bin.to <= usual.to ? [index] : []));
  const usualStart = usualBins[0];
  const usualEnd = usualBins.at(-1);
  const hovered = hover == null ? null : bins[hover];

  return (
    <figure className="w-full rounded-lg border border-line bg-surface-raised p-4">
      <figcaption className="mb-3">
        <div className="type-heading">{title}</div>
        <div className="type-caption text-ink-muted tabular-nums">{summary ?? 'No sitting in this period gave one'}</div>
      </figcaption>

      {bins.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 type-caption text-ink-muted">
          The chart fills in as sittings finish with a reading.
        </p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden onMouseLeave={() => setHover(null)} className="block h-auto w-full">
            {usualStart != null && usualEnd != null ? (
              <>
                <rect
                  className="fill-surface-sunken"
                  x={left(usualStart)}
                  y={MARGIN.top - 22}
                  width={(usualEnd - usualStart + 1) * slot}
                  height={plotBottom - MARGIN.top + 22}
                  rx={4}
                />
                <text className="fill-ink-muted font-sans text-[12px]" x={left(usualStart) + 8} y={MARGIN.top - 7}>
                  {usual.from} to {usual.to} scores 0
                </text>
              </>
            ) : null}
            <line className="stroke-line-strong" strokeWidth={1} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={plotBottom} y2={plotBottom} />
            {bins.map((bin, index) => {
              const height = barHeight(bin.sittings);
              const x = left(index) + (slot - BAR) / 2;
              const y = plotBottom - height;
              return (
                <g key={bin.from} onMouseEnter={() => setHover(index)}>
                  {/* The whole slot answers the pointer, not only the bar. */}
                  <rect fill="transparent" x={left(index)} y={0} width={slot} height={HEIGHT} />
                  {bin.sittings > 0 ? (
                    <>
                      <path
                        className={cx('fill-series-estimate', hover != null && hover !== index && 'opacity-50')}
                        d={`M${x} ${plotBottom}V${y + 4}a4 4 0 0 1 4 -4h${BAR - 8}a4 4 0 0 1 4 4V${plotBottom}Z`}
                      />
                      <text className="fill-ink font-mono text-[13px] font-semibold tabular-nums" x={x + BAR / 2} y={y - 6} textAnchor="middle">
                        {bin.sittings}
                      </text>
                    </>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text className="fill-ink-muted font-sans text-[12px] tabular-nums" x={left(index) + slot / 2} y={plotBottom + 18} textAnchor="middle">
                      {bin.from}–{bin.to}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {hover != null && hovered ? (
            <div
              className={cx(
                'pointer-events-none absolute top-0 rounded-md border border-line bg-surface-raised px-3 py-2 text-[13px] leading-[20px] whitespace-nowrap shadow-overlay',
                hover >= bins.length / 2 ? '-translate-x-full' : '',
              )}
              style={{ left: `${((left(hover) + (hover >= bins.length / 2 ? 0 : slot)) / WIDTH) * 100}%` }}
            >
              <div className="text-ink-muted">
                {hovered.from} to {hovered.to} {unit}
              </div>
              <div className="font-semibold tabular-nums">{sittings(hovered.sittings)}</div>
            </div>
          ) : null}
          <table className="sr-only">
            <caption>
              {title}: sittings by {unit}
            </caption>
            <thead>
              <tr>
                <th scope="col">Range, {unit}</th>
                <th scope="col">Sittings</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((bin) => (
                <tr key={bin.from}>
                  <td>
                    {bin.from} to {bin.to}
                  </td>
                  <td>{bin.sittings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
