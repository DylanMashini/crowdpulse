// How the dashboard tells the sign-in page why staff were sent there. The app shell puts one
// of these in the `reason` query parameter; the sign-in form turns it into a sentence.

/** The session ended while the dashboard was open and nothing staff did was lost. */
export const SESSION_ENDED = 'expired';
/** The session ended and a change (an acknowledgement, a typed field) was refused because of it. */
export const SESSION_ENDED_UNSAVED = 'unsaved';

/** The sentence above the sign-in form. Null for a plain visit and for any value it does not know. */
export function sessionEndedText(reason: string | undefined): string | null {
  switch (reason) {
    case SESSION_ENDED:
      return 'Your session ended. Sign in to carry on where you left off.';
    case SESSION_ENDED_UNSAVED:
      return 'Your session ended before your last action went through. Sign in, then do it again.';
    default:
      return null;
  }
}
