const WIDTH = 48;
const HEIGHT = 24;
const PAD = 5;

/**
 * The shape of a patient's heart rate over their observations, oldest first. It shows the
 * direction only: the numbers are beside it in the row. Nothing is drawn for fewer than two.
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const x = (index: number) => PAD + ((WIDTH - 2 * PAD) * index) / (values.length - 1);
  // A flat line sits in the middle instead of on the floor.
  const y = (value: number) => (high === low ? HEIGHT / 2 : PAD + (HEIGHT - 2 * PAD) * (1 - (value - low) / (high - low)));
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} aria-hidden className="flex-none">
      <polyline className="fill-none stroke-line-strong" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points} />
      <circle className="fill-series-estimate stroke-surface-raised" strokeWidth={2} cx={x(last)} cy={y(values[last] as number)} r={4} />
    </svg>
  );
}
