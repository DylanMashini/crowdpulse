// Opening and closing a patient's flags to match its rules, without the database: the store is
// passed in, so the tests can run two requests against each other in every possible order.
import { FLAG_RULE_ORDER, type FlagRule } from "@triagecam/contracts";

import type { RuleStatus } from "./rules.ts";

/** What the rules say about a patient, and the flags that are open for it. */
export type RuleState<F extends { rule: FlagRule }> = {
  rules: Record<FlagRule, RuleStatus>;
  openFlags: F[];
};

export type RulePlan = { open: FlagRule[]; close: FlagRule[] };

/** The flags to open and to close so the open flags match the rules. Both lists are in rule order. */
export function planRules(state: RuleState<{ rule: FlagRule }>): RulePlan {
  const plan: RulePlan = { open: [], close: [] };
  for (const rule of FLAG_RULE_ORDER) {
    const open = state.openFlags.some((flag) => flag.rule === rule);
    if (!open && state.rules[rule].met) plan.open.push(rule);
    else if (open && state.rules[rule].cleared) plan.close.push(rule);
  }
  return plan;
}

/** The two writes, made inside the patient's lock. Each answers with the row, or nothing if it changed nothing. */
export type RuleWriter<S, F> = {
  /** Opens a flag for the rule at that instant, on the numbers in `state`. */
  open(rule: FlagRule, at: Date, state: S): Promise<F | undefined>;
  close(flag: F, at: Date): Promise<F | undefined>;
};

export type RuleStore<S, F> = {
  /**
   * Runs `work` while no other request can open or close this patient's flags, and hands it the
   * patient's state as it is stored once the lock is held, not as the caller read it earlier.
   */
  locked<T>(work: (state: S, write: RuleWriter<S, F>) => Promise<T>): Promise<T>;
};

export type RuleChange<F> = { type: "opened" | "closed"; flag: F };

/**
 * Opens and closes one patient's flags to match its rules.
 *
 * Any request may get here for the same patient at the same moment: a sitting being finished,
 * a worklist being computed, the overdue timer. The trend flags that one sitting raises are one
 * alert because they open at the same instant (`alertIdOf`), so they must all be opened by one
 * request, with its `now`. That is what the lock is for: the request that holds it decides on
 * the stored state and opens every flag that is due; a request that was waiting then finds them
 * open and opens nothing. Without it, two requests that had both read "no flag open" could each
 * open one of the two trend flags, at two instants, and one deterioration became two alerts.
 *
 * `seen` is what the caller has already read. If nothing is due on it, the lock is not taken, so
 * computing a quiet worklist costs no transaction. `state` in the answer is the state the
 * changes were decided on, with the open flags as they now stand; null when the lock was not
 * taken and `seen` still holds.
 */
export async function applyRules<F extends { rule: FlagRule }, S extends RuleState<F>>(
  seen: S,
  now: Date,
  store: RuleStore<S, F>,
): Promise<{ changes: RuleChange<F>[]; state: S | null }> {
  const due = planRules(seen);
  if (due.open.length === 0 && due.close.length === 0) return { changes: [], state: null };

  return store.locked(async (state, write) => {
    const plan = planRules(state);
    const changes: RuleChange<F>[] = [];
    let openFlags = state.openFlags;
    for (const rule of FLAG_RULE_ORDER) {
      if (plan.open.includes(rule)) {
        const flag = await write.open(rule, now, state);
        if (!flag) continue;
        openFlags = [...openFlags, flag];
        changes.push({ type: "opened", flag });
      } else if (plan.close.includes(rule)) {
        for (const open of openFlags.filter((flag) => flag.rule === rule)) {
          const flag = await write.close(open, now);
          openFlags = openFlags.filter((each) => each !== open);
          if (flag) changes.push({ type: "closed", flag });
        }
      }
    }
    return { changes, state: { ...state, openFlags } };
  });
}
