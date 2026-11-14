import { ProvenanceTag } from '@/components/ds';

/**
 * The camera's view during a sitting, drawn the way the product draws it: the regions it reads,
 * on a dark field, never a face. Still on purpose: the one moving thing on the page is the trace
 * in the hero.
 */
export function Viewfinder() {
  return (
    <figure className="lp-viewfinder" aria-label="The camera view during a sitting: outlined regions on the forehead and cheeks for the pulse, and on the chest for breathing">
      <svg className="lp-viewfinder-scene" viewBox="0 0 480 330" role="presentation" aria-hidden="true">
        {/* Head and shoulders, as flat shapes one surface step up */}
        <path d="M240 46c-45 0-76 34-76 82 0 50 32 92 76 92s76-42 76-92c0-48-31-82-76-82z" className="lp-vf-body" />
        <path d="M84 330c6-64 50-94 112-98h88c62 4 106 34 112 98z" className="lp-vf-body" />
        {/* Measured regions */}
        <rect x="200" y="72" width="80" height="30" rx="4" className="lp-vf-region" />
        <rect x="178" y="142" width="40" height="34" rx="4" className="lp-vf-region" />
        <rect x="262" y="142" width="40" height="34" rx="4" className="lp-vf-region" />
        <rect x="168" y="262" width="144" height="46" rx="4" className="lp-vf-region lp-vf-region-motion" />
        {/* Leaders and labels */}
        <path d="M280 87h62M302 159h40M312 285h30" className="lp-vf-leader" />
        <text x="348" y="91" className="lp-vf-label">Forehead, pulse</text>
        <text x="348" y="163" className="lp-vf-label">Cheeks, pulse</text>
        <text x="348" y="289" className="lp-vf-label">Chest, breathing</text>
      </svg>
      <div className="lp-viewfinder-top" aria-hidden="true">
        <ProvenanceTag kind="live">Sitting in progress</ProvenanceTag>
        <span className="lp-viewfinder-timer">0:42 / 1:00</span>
      </div>
      <div className="lp-viewfinder-progress" aria-hidden="true">
        <span />
      </div>
    </figure>
  );
}
