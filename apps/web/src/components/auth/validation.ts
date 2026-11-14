import { Email, Password } from '@triagecam/contracts';
import { useMemo, useSyncExternalStore } from 'react';

/** Null when the address is usable; otherwise the sentence to show under the field. */
export function emailProblem(value: string): string | null {
  if (!value.trim()) return 'Enter your work email address';
  return Email.safeParse(value.trim()).success ? null : 'Enter an email address in the form name@example.org';
}

/** The same rule the server applies: 8 characters or more, at most 72 bytes. */
export function passwordProblem(value: string): string | null {
  if (!value) return 'Enter a password of 8 characters or more';
  return Password.safeParse(value).success ? null : 'Use 8 characters or more, and at most 72 bytes';
}

const PENDING_KEY = 'tc-pending-verification';

export interface PendingVerification {
  email: string;
  /** Only present when the server has no mail key and handed the token back instead of sending it. */
  devToken?: string;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    // Storage can be blocked. The check-your-email page then asks for the address.
    return null;
  }
}

/** Remembers, for this tab, which address is waiting for its verification email. */
export function rememberPending(pending: PendingVerification): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Nothing to do: the page works without the remembered address.
  }
  listeners.forEach((notify) => notify());
}

function parsePending(raw: string | null): PendingVerification | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'email' in parsed && typeof parsed.email === 'string') {
      const devToken = 'devToken' in parsed && typeof parsed.devToken === 'string' ? parsed.devToken : undefined;
      return { email: parsed.email, devToken };
    }
  } catch {
    // Unreadable storage is the same as nothing remembered.
  }
  return null;
}

/** The address waiting for verification in this tab, or null. Null on the server and before mount. */
export function usePendingVerification(): PendingVerification | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parsePending(raw), [raw]);
}
