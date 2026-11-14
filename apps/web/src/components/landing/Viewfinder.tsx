import { Icon } from '@/components/ds';

const BEAT = 80; // px per heartbeat on the trace
const BREATH = 360; // px per breath
const TRACE_WIDTH = 480;

/** One pulse beat, 0 to 1 across the beat: a fast upstroke, a slower fall and a dicrotic notch. */
function pulse(phase: number): number {
  const systolic = Math.exp(-((phase - 0.18) ** 2) / 0.006);
  const dicrotic = 0.36 * Math.exp(-((phase - 0.46) ** 2) / 0.012);
  return systolic + dicrotic;
}

function tracePath(period: number, height: number, wave: (phase: number) => number): string {
  const points: string[] = [];
  // Two periods beyond the window, so the loop can slide one period without a seam.
  for (let x = 0; x <= TRACE_WIDTH + period * 2; x += 2) {
    const y = height - 4 - wave((x % period) / period) * (height - 8);
    points.push(`${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const PULSE_PATH = tracePath(BEAT, 44, pulse);
const BREATH_PATH = tracePath(BREATH, 32, (phase) => 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));

/**
 * The camera role's view, drawn the way the product draws it: regions on a dark field, never
 * a face. The two traces move at the rates printed beside them (72 beats and 16 breaths a minute).
 */
export function Viewfinder() {
  return (
    <figure className="lp-viewfinder" aria-label="The camera view during a sitting: outlined regions on the forehead, cheeks and chest, a pulse of 72 bpm and breathing at 16 breaths per minute">
      <div className="lp-viewfinder-bar">
        <span className="lp-viewfinder-live">
          <Icon name="video" size={16} />
          Sitting in progress
        </span>
        <span className="lp-mono">0:42 of 1:00</span>
      </div>

      <svg className="lp-viewfinder-scene" viewBox="0 0 480 330" role="presentation" aria-hidden="true">
        {/* Framing corners */}
        <path d="M24 56V24h32M424 24h32v32M456 274v32h-32M56 306H24v-32" className="lp-vf-corner" />
        {/* Head and shoulders, as an outline */}
        <path d="M240 46c-45 0-76 34-76 82 0 50 32 92 76 92s76-42 76-92c0-48-31-82-76-82z" className="lp-vf-outline" />
        <path d="M96 330c4-58 42-84 96-92M384 330c-4-58-42-84-96-92" className="lp-vf-outline" />
        {/* Measured regions */}
        <rect x="200" y="72" width="80" height="30" rx="6" className="lp-vf-region" />
        <rect x="178" y="142" width="40" height="34" rx="6" className="lp-vf-region" />
        <rect x="262" y="142" width="40" height="34" rx="6" className="lp-vf-region" />
        <rect x="168" y="262" width="144" height="46" rx="6" className="lp-vf-region lp-vf-region-motion" />
        {/* Leaders and labels */}
        <path d="M280 87h62M302 159h40M312 285h30" className="lp-vf-leader" />
        <text x="348" y="91" className="lp-vf-label">Forehead</text>
        <text x="348" y="163" className="lp-vf-label">Cheeks</text>
        <text x="348" y="289" className="lp-vf-label">Chest motion</text>
      </svg>

      <div className="lp-viewfinder-readouts">
        <div className="lp-vf-readout">
          <div className="lp-vf-readout-head">
            <span className="lp-vf-readout-label">
              <Icon name="pulse" size={16} />
              Pulse
            </span>
            <span className="lp-vf-value">
              72<span className="lp-vf-unit">bpm</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${TRACE_WIDTH} 44`} preserveAspectRatio="none" className="lp-trace" aria-hidden="true">
            <path d={PULSE_PATH} className="lp-trace-line lp-trace-pulse" />
          </svg>
        </div>
        <div className="lp-vf-readout">
          <div className="lp-vf-readout-head">
            <span className="lp-vf-readout-label">
              <Icon name="breath" size={16} />
              Breathing
            </span>
            <span className="lp-vf-value">
              16<span className="lp-vf-unit">breaths per min</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${TRACE_WIDTH} 32`} preserveAspectRatio="none" className="lp-trace lp-trace-short" aria-hidden="true">
            <path d={BREATH_PATH} className="lp-trace-line lp-trace-breath" />
          </svg>
        </div>
      </div>
    </figure>
  );
}
