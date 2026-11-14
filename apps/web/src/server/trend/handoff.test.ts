import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type HandoffInput, handoffSentence } from "./handoff.ts";

const input = (values: Partial<HandoffInput>): HandoffInput => ({
  label: "Maya Chen",
  pulse: { base: 82, now: 108 },
  breathing: { base: 16, now: 24 },
  minutesLater: 26,
  minutesSinceObserved: 3,
  minutesWaiting: 30,
  latestGaveNoReading: false,
  ...values,
});

describe("handoffSentence", () => {
  it("matches the plan's example word for word", () => {
    assert.equal(
      handoffSentence(input({})),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 3 min ago.",
    );
  });

  it("rounds rates to whole numbers", () => {
    assert.equal(
      handoffSentence(input({ pulse: { base: 81.6, now: 107.5 }, breathing: { base: 16.2, now: 23.7 } })),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 3 min ago.",
    );
  });

  it("states check-in values alone while check-in is the only observation", () => {
    assert.equal(
      handoffSentence(input({ pulse: { base: 82, now: 82 }, breathing: { base: 16, now: 16 }, minutesLater: null })),
      "Maya Chen: pulse 82 bpm, breathing 16 breaths per min at check-in. Last observed 3 min ago.",
    );
    assert.equal(
      handoffSentence(input({ pulse: { base: 82, now: 82 }, breathing: { base: null, now: null }, minutesLater: null })),
      "Maya Chen: pulse 82 bpm at check-in. Last observed 3 min ago.",
    );
  });

  it("says so when a parameter has no reading now or was not measured at check-in", () => {
    assert.equal(
      handoffSentence(input({ breathing: { base: 16, now: null } })),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later); breathing 16 breaths per min at check-in, no reading now. Last observed 3 min ago.",
    );
    assert.equal(
      handoffSentence(input({ pulse: { base: null, now: 108 } })),
      "Maya Chen: pulse 108 bpm now, not measured at check-in; breathing 16 breaths per min at check-in, 24 breaths per min now (26 min later). Last observed 3 min ago.",
    );
  });

  it("leaves out a parameter that was never measured", () => {
    assert.equal(
      handoffSentence(input({ breathing: { base: null, now: null } })),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later). Last observed 3 min ago.",
    );
  });

  it("covers a patient that has not been observed", () => {
    assert.equal(
      handoffSentence(input({ minutesSinceObserved: null, minutesLater: null, minutesWaiting: 31 })),
      "Maya Chen: not yet observed, waiting 31 min.",
    );
  });

  it("gives long times in hours, as the rest of the dashboard does", () => {
    assert.equal(
      handoffSentence(input({ minutesLater: 75, minutesSinceObserved: 60 })),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (1 h 15 min later); breathing 16 to 24 breaths per min. Last observed 1 h ago.",
    );
    assert.equal(
      handoffSentence(input({ minutesSinceObserved: null, minutesLater: null, minutesWaiting: 135 })),
      "Maya Chen: not yet observed, waiting 2 h 15 min.",
    );
    assert.equal(
      handoffSentence(input({ pulse: { base: 82, now: 82 }, breathing: { base: null, now: null }, minutesLater: null, minutesSinceObserved: 0 })),
      "Maya Chen: pulse 82 bpm at check-in. Last observed just now.",
    );
  });

  it("adds that the latest sitting gave no reading", () => {
    assert.equal(
      handoffSentence(input({ minutesSinceObserved: 41, latestGaveNoReading: true })),
      "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 41 min ago. The latest sitting gave no reading.",
    );
    assert.equal(
      handoffSentence(input({ minutesSinceObserved: null, minutesWaiting: 6, latestGaveNoReading: true })),
      "Maya Chen: not yet observed, waiting 6 min. The latest sitting gave no reading.",
    );
  });
});
