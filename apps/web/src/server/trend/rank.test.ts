import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Rankable, rankTickets, tileState } from "./rank.ts";

const minutesAgo = (minutes: number) => new Date(Date.parse("2026-11-14T16:00:00.000Z") - minutes * 60_000);

const item = (ticketNumber: number, values: Partial<Rankable>): Rankable => ({
  ticketNumber,
  state: "observed",
  score: 0,
  flagOpenedAt: null,
  unobservedSince: minutesAgo(5),
  ...values,
});

describe("tileState", () => {
  const none = { trendFlagOpen: false, latestGaveNoReading: false, overdueFlagOpen: false };

  it("is exactly one state, the first that applies", () => {
    assert.equal(tileState(none), "observed");
    assert.equal(tileState({ ...none, overdueFlagOpen: true }), "overdue");
    assert.equal(tileState({ ...none, latestGaveNoReading: true }), "no-reading");
    assert.equal(tileState({ ...none, latestGaveNoReading: true, overdueFlagOpen: true }), "no-reading");
    assert.equal(tileState({ trendFlagOpen: true, latestGaveNoReading: true, overdueFlagOpen: true }), "flag");
  });
});

describe("rankTickets", () => {
  const order = (items: Rankable[]) => rankTickets(items).map((ranked) => ranked.ticketNumber);

  it("puts flags first, then overdue and no-reading, then observed", () => {
    const ranked = order([
      item(1, { state: "observed", unobservedSince: minutesAgo(29) }),
      item(2, { state: "overdue", unobservedSince: minutesAgo(40) }),
      item(3, { state: "flag", score: 1, flagOpenedAt: minutesAgo(2), unobservedSince: minutesAgo(2) }),
      item(4, { state: "no-reading", unobservedSince: minutesAgo(35) }),
    ]);
    assert.deepEqual(ranked, [3, 2, 4, 1]);
  });

  it("orders flags by higher score, then by the flag that opened earliest", () => {
    const ranked = order([
      item(1, { state: "flag", score: 2, flagOpenedAt: minutesAgo(3) }),
      item(2, { state: "flag", score: 3, flagOpenedAt: minutesAgo(1) }),
      item(3, { state: "flag", score: 2, flagOpenedAt: minutesAgo(9) }),
    ]);
    assert.deepEqual(ranked, [2, 3, 1]);
  });

  it("ranks a no-reading ticket as overdue: the two share one group, longest unobserved first", () => {
    const ranked = order([
      item(1, { state: "overdue", unobservedSince: minutesAgo(33) }),
      item(2, { state: "no-reading", unobservedSince: minutesAgo(50) }),
      item(3, { state: "overdue", unobservedSince: minutesAgo(41) }),
    ]);
    assert.deepEqual(ranked, [2, 3, 1]);
  });

  it("orders observed tickets by the longest time since the last observation", () => {
    const ranked = order([
      item(1, { unobservedSince: minutesAgo(4) }),
      item(2, { unobservedSince: minutesAgo(22) }),
      item(3, { unobservedSince: minutesAgo(11) }),
    ]);
    assert.deepEqual(ranked, [2, 3, 1]);
  });

  it("breaks a full tie by ticket number and leaves its input untouched", () => {
    const items = [item(9, {}), item(4, {})];
    assert.deepEqual(order(items), [4, 9]);
    assert.equal(items[0]?.ticketNumber, 9);
  });
});
