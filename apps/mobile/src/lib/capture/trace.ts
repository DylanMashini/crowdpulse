/** One value per second of a sitting. Null is a second without a valid reading. */
export type Trace = (number | null)[];

/** The trace with one more second on it, keeping the newest `capacity` seconds. */
export function pushTrace(trace: Trace, value: number | null, capacity: number): Trace {
  return [...trace, value].slice(-capacity);
}

export type TracePoint = { x: number; y: number };

/**
 * Where the trace is drawn in a box of `width` by `height`: one run of points per unbroken
 * stretch of readings, so a gap in the readings is a gap in the line. Seconds run left to
 * right over `capacity`; the vertical scale covers the values with at least `minSpan` units,
 * so a steady reading is a level line and not noise blown up to fill the box.
 */
export function traceRuns(
  trace: Trace,
  box: { width: number; height: number; pad: number },
  capacity: number,
  minSpan: number,
): TracePoint[][] {
  const values = trace.filter((value): value is number => value != null);
  if (values.length === 0 || box.width <= 0) return [];
  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = Math.max(high - low, minSpan);
  const floor = (high + low) / 2 - span / 2;
  const inner = { width: box.width - 2 * box.pad, height: box.height - 2 * box.pad };
  const step = capacity > 1 ? inner.width / (capacity - 1) : 0;
  const runs: TracePoint[][] = [];
  let run: TracePoint[] = [];
  trace.forEach((value, index) => {
    if (value == null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: box.pad + index * step, y: box.pad + inner.height - ((value - floor) / span) * inner.height });
  });
  if (run.length > 0) runs.push(run);
  return runs;
}
