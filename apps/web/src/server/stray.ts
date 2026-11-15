import type { CameraState } from "@triagecam/contracts";

// A sitting whose phone has gone must not stay open: the worklist would show it in progress
// for ever and the check-in page would wait on it. The phone normally ends its own sittings
// (finish, or abandon when the screen is left); this is for when it cannot, because the app
// was closed or the phone lost power or network for good.

/**
 * The phone is reporting, and what it reports is not this sitting (it is back at the check-in
 * list, or framing someone else). The summary of a sitting that finished normally arrives
 * within a second of that; after this long it is not coming.
 */
export const ELSEWHERE_AFTER_MS = 10_000;

/**
 * The phone is not reporting at all and has sent no reading for this long. A sitting is 60
 * seconds, so a phone silent for 90 has finished or died. If it was only out of reach, the
 * summary it sends when it comes back is still stored (finishSitting fills in a sitting that
 * ended without one).
 */
export const SILENT_AFTER_MS = 90_000;

const IN_SITTING: ReadonlySet<CameraState["phase"]> = new Set(["starting", "running", "stopping"]);

export interface OpenSitting {
  id: string;
  /** Server clock, ms. */
  startedAt: number;
  /** Server clock of the newest stored reading, ms. Null when there is none. */
  lastReadingAt: number | null;
}

/** Since when each open sitting's phone has been reporting something else. Kept by the caller between looks. */
export type Elsewhere = Map<string, number>;

/** True when the sitting should be ended without a summary now. */
export function sittingIsStray(sitting: OpenSitting, camera: CameraState | null, elsewhere: Elsewhere, now: number): boolean {
  if (camera) {
    const here = IN_SITTING.has(camera.phase) && (camera.sittingId === null || camera.sittingId === sitting.id);
    if (here) {
      elsewhere.delete(sitting.id);
      return false;
    }
    const since = elsewhere.get(sitting.id) ?? now;
    elsewhere.set(sitting.id, since);
    return now - since >= ELSEWHERE_AFTER_MS;
  }
  elsewhere.delete(sitting.id);
  return now - Math.max(sitting.startedAt, sitting.lastReadingAt ?? 0) >= SILENT_AFTER_MS;
}
