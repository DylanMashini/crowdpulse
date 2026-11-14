import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TimelineEntry } from "@triagecam/contracts";

import { distinctAcknowledgements, orderTimeline } from "./timeline.ts";

const at = (minute: number) => `2026-11-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const sitting = (minute: number, n: number): TimelineEntry => ({
  type: "sitting",
  at: at(minute),
  sittingId: id(n),
  kind: "recheck",
  source: "camera",
  heartRate: 108,
  breathingRate: 24,
  score: 2,
});
const opened = (minute: number, n: number, rule: "score_rise" | "baseline_shift"): TimelineEntry => ({
  type: "flag_opened",
  at: at(minute),
  flagId: id(n),
  // The trend flags one sitting raised are one alert, named by the instant they opened.
  alertId: `trend-14-${minute}`,
  rule,
  handoff: "Patient 2: pulse 82 bpm at check-in, 108 bpm now (26 min later).",
});

describe("orderTimeline", () => {
  it("is newest first", () => {
    const ordered = orderTimeline([{ type: "created", at: at(0) }, sitting(2, 1), sitting(20, 2)]);
    assert.deepEqual(ordered.map((entry) => entry.at), [at(20), at(2), at(0)]);
  });

  it("puts a sitting before the flags it raised at the same instant, read oldest first", () => {
    // The order the patient detail builds them in, and the reverse, give the same answer.
    const entries = [sitting(28, 3), opened(28, 4, "score_rise"), opened(28, 5, "baseline_shift")];
    for (const input of [entries, [...entries].reverse()]) {
      const oldestFirst = orderTimeline(input).reverse();
      assert.deepEqual(oldestFirst.map((entry) => entry.type), ["sitting", "flag_opened", "flag_opened"]);
    }
  });

  it("orders one instant as sitting, closed, opened, acknowledged, discharged", () => {
    const entries: TimelineEntry[] = [
      { type: "discharged", at: at(30) },
      { type: "flag_acknowledged", at: at(30), flagId: id(4), by: "nurse@example.test" },
      opened(30, 4, "score_rise"),
      { type: "flag_closed", at: at(30), flagId: id(6), rule: "overdue", alertId: id(6) },
      sitting(30, 3),
    ];
    assert.deepEqual(
      orderTimeline(entries)
        .reverse()
        .map((entry) => entry.type),
      ["sitting", "flag_closed", "flag_opened", "flag_acknowledged", "discharged"],
    );
  });
});

describe("distinctAcknowledgements", () => {
  const when = new Date(at(31));

  it("shows one acknowledgement that covered two flags once", () => {
    const rows = [
      { flagId: id(4), at: when, by: "nurse@example.test" },
      { flagId: id(5), at: when, by: "nurse@example.test" },
    ];
    assert.deepEqual(distinctAcknowledgements(rows), [rows[0]]);
  });

  it("keeps acknowledgements by different people or at different times", () => {
    const rows = [
      { flagId: id(4), at: when, by: "nurse@example.test" },
      { flagId: id(4), at: when, by: "charge@example.test" },
      { flagId: id(5), at: new Date(at(40)), by: "nurse@example.test" },
    ];
    assert.deepEqual(distinctAcknowledgements(rows), rows);
  });
});
