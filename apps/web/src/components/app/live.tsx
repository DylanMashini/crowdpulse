'use client';

import type { StreamEvent, WorklistResponse } from '@triagecam/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { clockOffsetMs } from '@/lib/clock';
import { openStream, type StreamStatus } from '@/lib/stream';
import { useResource, type Resource } from '@/lib/use-resource';

/** `reconnected` is raised here when the stream comes back: events are not replayed, so refetch. */
export type LiveEvent = StreamEvent | { type: 'reconnected' };
type Listener = (event: LiveEvent) => void;

export interface LoadedWorklist {
  worklist: WorklistResponse;
  /** Server clock minus this browser's clock, measured on the request that fetched the worklist. */
  serverOffsetMs: number;
}

interface LiveContext {
  status: StreamStatus;
  subscribe: (listener: Listener) => () => void;
  worklist: Resource<LoadedWorklist>;
}

const Context = createContext<LiveContext | null>(null);

const WORKLIST_EVENTS: ReadonlySet<LiveEvent['type']> = new Set([
  'worklist_changed',
  'patient_changed',
  'flag_opened',
  'flag_acknowledged',
  'flag_closed',
  'sitting_started',
  'sitting_finished',
  'reconnected',
]);

/** Ages are whole minutes, so the worklist is also refreshed on a timer in case no event arrives. */
const WORKLIST_REFRESH_MS = 30_000;

async function loadWorklist(): Promise<LoadedWorklist> {
  const sentAt = Date.now();
  const worklist = await api.worklist();
  return { worklist, serverOffsetMs: clockOffsetMs(worklist.generatedAt, sentAt, Date.now()) };
}

/** One readings stream and one worklist for the whole dashboard. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const listeners = useRef(new Set<Listener>());
  const worklist = useResource('worklist', loadWorklist);
  const reloadWorklist = worklist.reload;

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let dropped = false;
    const emit = (event: LiveEvent) => {
      if (WORKLIST_EVENTS.has(event.type)) reloadWorklist();
      listeners.current.forEach((listener) => listener(event));
    };
    const close = openStream({
      onEvent: emit,
      onStatus: (next) => {
        setStatus(next);
        if (next === 'reconnecting') dropped = true;
        if (next === 'open' && dropped) {
          dropped = false;
          emit({ type: 'reconnected' });
        }
      },
    });
    const refresh = setInterval(reloadWorklist, WORKLIST_REFRESH_MS);
    return () => {
      close();
      clearInterval(refresh);
    };
  }, [reloadWorklist]);

  const value = useMemo(() => ({ status, subscribe, worklist }), [status, subscribe, worklist]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLive(): LiveContext {
  const context = useContext(Context);
  if (!context) throw new Error('useLive needs a LiveProvider above it');
  return context;
}

/** Calls `handler` for every stream event while the component is mounted. */
export function useLiveEvents(handler: Listener): void {
  const { subscribe } = useLive();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
