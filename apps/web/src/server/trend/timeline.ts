import type { TimelineEntry } from "@triagecam/contracts";

/**
 * Where an entry stands among others at the same instant: a cause before what it causes.
 * A sitting finishes, then the flags it closes and opens follow, then an acknowledgement.
 */
const ORDER: Record<TimelineEntry["type"], number> = {
  created: 0,
  sitting: 1,
  flag_closed: 2,
  flag_opened: 3,
  flag_acknowledged: 4,
  discharged: 5,
};

/**
 * Newest first. Entries at the same instant keep their causal order, so read oldest first
 * a sitting comes before the flags it raised. A flag opens in the request that finishes the
 * sitting, often in the same millisecond, and time alone would list them either way round.
 */
export function orderTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        b.entry.at.localeCompare(a.entry.at) || ORDER[b.entry.type] - ORDER[a.entry.type] || b.index - a.index,
    )
    .map(({ entry }) => entry);
}

type Acknowledgement = { flagId: string; at: Date; by: string };

/**
 * One acknowledgement covers every flag of an alert, usually both trend flags of one
 * deterioration (see `acknowledgeFlag`). It was one act by one person, so the timeline shows
 * it once, under the first flag it covered.
 */
export function distinctAcknowledgements<T extends Acknowledgement>(acknowledgements: T[]): T[] {
  const seen = new Set<string>();
  return acknowledgements.filter((acknowledgement) => {
    const key = `${acknowledgement.at.getTime()} ${acknowledgement.by}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
