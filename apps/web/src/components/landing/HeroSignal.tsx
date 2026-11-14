'use client';

import { LiveTrace, ProvenanceTag, Readout } from '@/components/ds';

/** The rates the example draws at and prints. */
const PULSE = 72;
const BREATHING = 16;

/**
 * The product's signature in the hero: a trace and the two numbers it stands for. It is an
 * example, drawn at fixed rates, and says so beside the tag.
 */
export function HeroSignal() {
  return (
    <figure
      className="lp-signal"
      aria-label={`An example of the live readings during a sitting: a pulse trace, a pulse of ${PULSE} bpm and breathing at ${BREATHING} breaths per minute`}
    >
      <div className="lp-signal-head" aria-hidden="true">
        <ProvenanceTag kind="live" reading>
          Live
        </ProvenanceTag>
        <span>Example signal, simulated</span>
      </div>
      <LiveTrace kind="pulse" rate={PULSE} seconds={6} className="lp-signal-trace" />
      <div className="lp-signal-readouts" aria-hidden="true">
        <Readout label="Pulse" icon="pulse" value={PULSE} unit="bpm" live />
        <Readout label="Breathing" icon="breath" value={BREATHING} unit="breaths/min" live />
      </div>
    </figure>
  );
}
