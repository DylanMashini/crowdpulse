// When the interface is held in landscape for a sitting.
//
// The sitting screen used to take the lock in its mount effect and give it back in its unmount
// effect. Both run at the start of the navigator's push or pop, so the interface rotated while
// the native stack was still moving the screens; after the first sitting screen had closed
// that way, the stack dismissed the next one about a second after it opened (BUG-14: only the
// first sitting of a run of the app opened when the phone was upright). Nothing else in the app
// was wrong: with the lock taken out, every sitting opened.
//
// The lock is now changed only when a screen's transition has ended: the navigator says so with
// `transitionEnd`, once the screen that was coming in has arrived. Which screen arrived decides
// the lock, so it never turns while screens are moving.

/** The camera role's screen that is used in landscape, on the mount. */
export const LANDSCAPE_SCREEN = 'sitting';

export type TransitionEnd = {
  /** The route the event is about: the file name of the screen. */
  screen: string;
  /** True for the screen that was leaving; false for the one that has arrived. */
  closing: boolean;
};

/**
 * Follows the navigator's `transitionEnd` events and turns the lock on when the sitting screen
 * has arrived and off when any other screen has. A screen that has finished leaving changes
 * nothing: the one that took its place says what the lock should be. `setLock` is called only
 * when the lock changes.
 */
export function createLandscapeLock(setLock: (locked: boolean) => void) {
  let locked = false;
  const apply = (next: boolean) => {
    if (next === locked) return;
    locked = next;
    setLock(next);
  };
  return {
    transitionEnded({ screen, closing }: TransitionEnd): void {
      if (closing) return;
      apply(screen === LANDSCAPE_SCREEN);
    },
    /** The camera role is being left altogether: give the lock back. */
    release(): void {
      apply(false);
    },
  };
}
