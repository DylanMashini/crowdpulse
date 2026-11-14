import { useSyncExternalStore } from 'react';

// One shared one-second tick, so every age on a page changes together and nothing reads the
// clock during render.
let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const read = () => current;
const readOnServer = () => 0;

/** The browser clock in ms, refreshed once per second. 0 until the page has mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, read, readOnServer);
}

/**
 * Server clock minus browser clock, in ms, from a timestamp the server stamped on a response.
 * The request's midpoint stands in for the moment the server read its clock.
 */
export function clockOffsetMs(serverTime: string, sentAtMs: number, receivedAtMs: number): number {
  return Math.round(new Date(serverTime).getTime() - (sentAtMs + receivedAtMs) / 2);
}
