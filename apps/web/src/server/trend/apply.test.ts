import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FlagRule } from "@triagecam/contracts";

import { applyRules, planRules, type RuleState, type RuleStore } from "./apply.ts";
import type { RuleStatus } from "./rules.ts";

type Row = { rule: FlagRule; openedAt: number; closedAt: number | null; openedBy: string };
type State = RuleState<Row>;
type Step = number | string;

const MET: RuleStatus = { met: true, cleared: false };
const QUIET: RuleStatus = { met: false, cleared: true };
/** A re-check has just tripped both trend rules, as one deterioration usually does. */
const BOTH_TREND_RULES = { score_rise: MET, baseline_shift: MET, overdue: QUIET };

/**
 * A stand-in for the flags table and two requests working on it, stepped by hand. Every read
 * and write waits for its turn, and the schedule says which request moves next, so one run is
 * one exact interleaving and every interleaving can be tried.
 */
function room(rules: Record<FlagRule, RuleStatus>, options: { exclusive: boolean; discharged?: boolean }) {
  const rows: Row[] = [];
  const waiting: { request: string; go: () => void }[] = [];
  let lockHeld = Promise.resolve();

  const turn = (request: string) => new Promise<void>((go) => waiting.push({ request, go }));
  const read = (): State => ({ rules, openFlags: rows.filter((row) => row.closedAt === null) });

  const store = (request: string): RuleStore<State, Row> => ({
    locked: async (work) => {
      const body = async () => {
        await turn(request);
        return work(options.discharged ? null : read(), {
          open: async (rule, at) => {
            await turn(request);
            // The unique index: one open flag per patient and rule.
            if (rows.some((row) => row.rule === rule && row.closedAt === null)) return undefined;
            const row: Row = { rule, openedAt: at.getTime(), closedAt: null, openedBy: request };
            rows.push(row);
            return row;
          },
          close: async (flag, at) => {
            await turn(request);
            if (flag.closedAt !== null) return undefined;
            flag.closedAt = at.getTime();
            return flag;
          },
        });
      };
      // Asking for the lock is a step too: which request gets it first is part of the schedule.
      await turn(request);
      if (!options.exclusive) return body();
      const held = lockHeld.then(body);
      lockHeld = held.then(
        () => undefined,
        () => undefined,
      );
      return held;
    },
  });

  /** Lets whichever requests can move reach their next step. */
  const settle = () => new Promise<void>((done) => setImmediate(done));

  /**
   * Runs the requests to the end. At each step `schedule` picks which waiting request moves, by
   * name or by its place in the queue (the first in the queue when the schedule runs out or
   * names a request that cannot move). Returns how many could have moved at each step.
   */
  async function run(requests: Promise<unknown>[], schedule: Step[]): Promise<number[]> {
    let running = requests.length;
    for (const request of requests) void request.finally(() => (running -= 1));
    const choices: number[] = [];
    for (;;) {
      await settle();
      if (waiting.length === 0) {
        if (running === 0) return choices;
        throw new Error("The requests are stuck");
      }
      const step = schedule[choices.length] ?? 0;
      const pick = typeof step === "number" ? step : Math.max(0, waiting.findIndex((each) => each.request === step));
      choices.push(waiting.length);
      waiting.splice(pick, 1)[0]?.go();
    }
  }

  return { rows, read, store, run };
}

/** Every schedule there is, one run each: the next one changes the last step that had another choice. */
async function everyInterleaving(once: (schedule: number[]) => Promise<number[]>): Promise<number> {
  let schedule: number[] = [];
  for (let runs = 1; ; runs += 1) {
    const choices = await once(schedule);
    const taken = choices.map((_, step) => schedule[step] ?? 0);
    let last = taken.length - 1;
    while (last >= 0 && (taken[last] as number) + 1 >= (choices[last] as number)) last -= 1;
    if (last < 0) return runs;
    schedule = [...taken.slice(0, last), (taken[last] as number) + 1];
  }
}

/**
 * BUG-8: a sitting is finished while a dashboard reloads the worklist. Both requests read the
 * patient before either wrote, so both see the two trend rules met and no flag open, and their
 * clocks are 4 ms apart.
 */
async function finishAgainstWorklist(schedule: Step[], exclusive: boolean) {
  const table = room(BOTH_TREND_RULES, { exclusive });
  const seen = table.read();
  const finish = applyRules(seen, new Date(336), table.store("finish"));
  const worklist = applyRules(seen, new Date(340), table.store("worklist"));
  const choices = await table.run([finish, worklist], schedule);
  return { rows: table.rows, choices, opened: [await finish, await worklist].map((result) => result.changes.map((change) => change.flag)) };
}

/**
 * The interleaving QA caught. Each request starts and reads; finish opens score_rise; worklist
 * finds it open and opens baseline_shift on its own clock; finish finds that one open.
 */
const SPLITS = ["finish", "worklist", "finish", "worklist", "finish", "worklist", "worklist", "finish"];

describe("planRules", () => {
  it("opens what is met and not open, closes what is open and cleared, in rule order", () => {
    assert.deepEqual(planRules({ rules: BOTH_TREND_RULES, openFlags: [] }), { open: ["score_rise", "baseline_shift"], close: [] });
    assert.deepEqual(planRules({ rules: BOTH_TREND_RULES, openFlags: [{ rule: "baseline_shift" }, { rule: "overdue" }] }), {
      open: ["score_rise"],
      close: ["overdue"],
    });
    // One raised observation is neither met nor cleared: nothing opens and nothing closes.
    const pending = { met: false, cleared: false };
    assert.deepEqual(planRules({ rules: { score_rise: pending, baseline_shift: pending, overdue: QUIET }, openFlags: [{ rule: "score_rise" }] }), {
      open: [],
      close: [],
    });
  });
});

describe("applyRules", () => {
  it("does not take the lock when nothing is due", async () => {
    const quiet = { score_rise: QUIET, baseline_shift: QUIET, overdue: QUIET };
    const result = await applyRules({ rules: quiet, openFlags: [] as Row[] }, new Date(1), {
      locked: () => assert.fail("The lock was taken"),
    });
    assert.deepEqual(result, { changes: [], state: null });
  });

  it("decides on what is stored once it holds the lock, not on what the caller read", async () => {
    // The caller read "both rules met, nothing open". By the time it holds the lock the
    // observation that tripped them has been followed by a normal one.
    const table = room({ score_rise: QUIET, baseline_shift: QUIET, overdue: QUIET }, { exclusive: true });
    const request = applyRules({ rules: BOTH_TREND_RULES, openFlags: [] as Row[] }, new Date(5), table.store("late"));
    await table.run([request], []);
    assert.deepEqual((await request).changes, []);
    assert.deepEqual(table.rows, []);
  });

  it("opens nothing for a patient who was discharged before it got the lock", async () => {
    // A worklist request read the patient as waiting with both rules met; discharge then closed
    // the flags. Reading again under the lock, the request must not open them a second time.
    const table = room(BOTH_TREND_RULES, { exclusive: true, discharged: true });
    const request = applyRules({ rules: BOTH_TREND_RULES, openFlags: [] as Row[] }, new Date(5), table.store("worklist"));
    await table.run([request], []);
    assert.deepEqual(await request, { changes: [], state: null });
    assert.deepEqual(table.rows, []);
  });

  it("opens both trend flags of one sitting at one instant, and closes them at one", async () => {
    const table = room(BOTH_TREND_RULES, { exclusive: true });
    const opening = applyRules(table.read(), new Date(100), table.store("finish"));
    await table.run([opening], []);
    const { changes, state } = await opening;
    assert.deepEqual(changes.map((change) => [change.type, change.flag.rule, change.flag.openedAt]), [
      ["opened", "score_rise", 100],
      ["opened", "baseline_shift", 100],
    ]);
    assert.deepEqual(state?.openFlags.map((flag) => flag.rule), ["score_rise", "baseline_shift"]);

    const calm = room({ score_rise: QUIET, baseline_shift: QUIET, overdue: QUIET }, { exclusive: true });
    calm.rows.push(...table.rows);
    const closing = applyRules(calm.read(), new Date(200), calm.store("finish"));
    await calm.run([closing], []);
    const closed = await closing;
    assert.deepEqual(closed.changes.map((change) => [change.type, change.flag.rule, change.flag.closedAt]), [
      ["closed", "score_rise", 200],
      ["closed", "baseline_shift", 200],
    ]);
    assert.deepEqual(closed.state?.openFlags, []);
  });

  it("without the lock, a worklist request racing a sitting's finish splits one deterioration in two (BUG-8)", async () => {
    const { rows } = await finishAgainstWorklist(SPLITS, false);
    assert.deepEqual(rows.map((row) => [row.rule, row.openedAt, row.openedBy]), [
      ["score_rise", 336, "finish"],
      ["baseline_shift", 340, "worklist"],
    ]);
  });

  it("with the lock, the same race opens both flags at one instant in every interleaving (BUG-8)", async () => {
    // The schedule that splits the alert without the lock.
    const first = await finishAgainstWorklist(SPLITS, true);
    assert.deepEqual(first.rows.map((row) => [row.rule, row.openedAt]), [
      ["score_rise", 336],
      ["baseline_shift", 336],
    ]);

    const outcomes = new Set<string>();
    const runs = await everyInterleaving(async (schedule) => {
      const { rows, choices, opened } = await finishAgainstWorklist(schedule, true);
      assert.deepEqual(rows.map((row) => row.rule), ["score_rise", "baseline_shift"]);
      assert.equal(new Set(rows.map((row) => row.openedAt)).size, 1, `Two instants with schedule ${schedule.join(",")}`);
      // One request opened both, so one push goes out; the other opened nothing.
      assert.deepEqual(opened.map((flags) => flags.length).sort(), [0, 2]);
      outcomes.add(rows[0]?.openedBy ?? "");
      return choices;
    });
    assert.ok(runs >= 2, "More than one interleaving was tried");
    // Whichever request gets the lock first opens the alert.
    assert.deepEqual([...outcomes].sort(), ["finish", "worklist"]);
  });

  it("without the lock, some interleaving splits the alert: the search does reach the race", async () => {
    let split = 0;
    const runs = await everyInterleaving(async (schedule) => {
      const { rows, choices } = await finishAgainstWorklist(schedule, false);
      if (new Set(rows.map((row) => row.openedAt)).size > 1) split += 1;
      return choices;
    });
    assert.ok(split > 0 && split < runs, `${split} of ${runs} interleavings split`);
  });
});
