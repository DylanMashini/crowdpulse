// Intake text that has been typed but not yet saved, kept for the life of the browser tab so
// it survives the trip through sign-in when the session ends under the form. One entry per
// patient. It is removed as soon as the server has the text, and on a deliberate sign-out.

const PREFIX = 'triagecam:intake-draft:';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Null where there is no storage (the server, a browser that refuses it): nothing is kept. */
function tabStorage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** What is kept for the patient, as it was written: check it before use. Null when nothing is. */
export function readIntakeDraft(patientNumber: number, store: Store | null = tabStorage()): Record<string, unknown> | null {
  try {
    const text = store?.getItem(PREFIX + patientNumber);
    if (!text) return null;
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Keeps the patient's unsaved fields, or forgets the patient when there are none. */
export function keepIntakeDraft(patientNumber: number, draft: Record<string, unknown>, store: Store | null = tabStorage()): void {
  try {
    if (Object.keys(draft).length === 0) store?.removeItem(PREFIX + patientNumber);
    else store?.setItem(PREFIX + patientNumber, JSON.stringify(draft));
  } catch {
    // Storage is full or refused: the form still works, the text just does not outlive the page.
  }
}

/** Forgets what is kept for the patient, but only if it is still exactly `sent`. */
export function forgetIntakeDraftIfUnchanged(patientNumber: number, sent: Record<string, unknown>, store: Store | null = tabStorage()): void {
  if (JSON.stringify(readIntakeDraft(patientNumber, store)) === JSON.stringify(sent)) keepIntakeDraft(patientNumber, {}, store);
}

/** Forgets every patient's draft: the next person at this screen must not find them. */
export function forgetIntakeDrafts(store: Store | null = tabStorage()): void {
  try {
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => key?.startsWith(PREFIX) ?? false);
    for (const key of keys) store.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}
