import type { PatientStatistics } from '@triagecam/contracts';

import { signed } from '@/lib/format';

const WIDTH = 720;
const ROW = 30;
const MARGIN = { top: 30, right: 24, bottom: 46, left: 96 };
/** The agreement target the pilot reports against: readings within 5 bpm of the reference. */
const TARGET_BPM = 5;

export interface BiasChartProps {
  patients: PatientStatistics[];
  /** Mean of estimate minus reference over every paired reading, in bpm. */
  overallBias: number | null;
}

/**
 * Bias per patient: how far, and in which direction, the camera estimate sat from the chest strap
 * on average. One row per patient, zero in the middle, the 5 bpm target as a band.
 */
export function BiasChart({ patients, overallBias }: BiasChartProps) {
  const biases = patients.flatMap((patient) => (patient.biasBpm == null ? [] : [Math.abs(patient.biasBpm)]));
  const extent = Math.max(10, Math.ceil((Math.max(0, ...biases) + 1) / 5) * 5);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const height = MARGIN.top + patients.length * ROW + MARGIN.bottom;
  const plotBottom = MARGIN.top + patients.length * ROW;
  const x = (bpm: number) => MARGIN.left + plotWidth * ((bpm + extent) / (2 * extent));

  const ticks: number[] = [];
  for (let tick = -extent; tick <= extent; tick += 5) ticks.push(tick);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="Chart of the mean difference between camera estimate and chest strap for each patient. The table of results per patient has the same numbers."
      className="block h-auto w-full"
    >
      <rect className="fill-surface-sunken" x={x(-TARGET_BPM)} y={MARGIN.top} width={x(TARGET_BPM) - x(-TARGET_BPM)} height={plotBottom - MARGIN.top} />
      <text className="fill-ink-muted font-sans text-[12px]" x={x(0)} y={MARGIN.top - 10} textAnchor="middle">
        Within {TARGET_BPM} bpm of the strap
      </text>

      {ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeWidth={1} x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={plotBottom} />
          <text className="fill-ink-muted font-mono text-[12px] tabular-nums" x={x(tick)} y={plotBottom + 18} textAnchor="middle">
            {tick === 0 ? '0' : signed(tick, 0)}
          </text>
        </g>
      ))}
      <text className="fill-ink-muted font-sans text-[12px]" x={x(0)} y={plotBottom + 38} textAnchor="middle">
        Camera minus chest strap, bpm
      </text>

      {overallBias != null ? (
        <line className="stroke-series-reference" strokeWidth={2} strokeDasharray="5 4" x1={x(overallBias)} x2={x(overallBias)} y1={MARGIN.top} y2={plotBottom} />
      ) : null}

      {patients.map((patient, index) => {
        const y = MARGIN.top + index * ROW + ROW / 2;
        const bias = patient.biasBpm;
        return (
          <g key={patient.patientNumber}>
            <text className="fill-ink-muted font-sans text-[12px] font-medium" x={12} y={y + 4}>
              Patient
            </text>
            <text className="fill-ink font-mono text-[15px] font-semibold tabular-nums" x={MARGIN.left - 14} y={y + 5} textAnchor="end">
              {patient.patientNumber}
            </text>
            {bias == null ? (
              <text className="fill-ink-muted font-sans text-[12px]" x={MARGIN.left + 8} y={y + 4}>
                No reading paired with the strap
              </text>
            ) : (
              <>
                <line className="stroke-series-estimate" strokeWidth={2} x1={x(0)} x2={x(bias)} y1={y} y2={y} />
                <circle className="fill-series-estimate stroke-surface-raised" strokeWidth={2} cx={x(bias)} cy={y} r={5} />
                <text
                  className="fill-ink stroke-surface-raised font-mono text-[12px] font-medium tabular-nums [paint-order:stroke]"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  x={x(bias) + (bias < 0 ? -10 : 10)}
                  y={y + 4}
                  textAnchor={bias < 0 ? 'end' : 'start'}
                >
                  {signed(bias)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
