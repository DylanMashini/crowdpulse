import type { ReferenceReading, Sitting, SittingDetailResponse, StoredReading } from '@triagecam/contracts';
import { useCallback, useEffect, useReducer } from 'react';

import { useLiveEvents } from '@/components/app/live';
import { ApiError, api } from '@/lib/api';

export interface FollowedSitting {
  /** `searching` until the first look for a running sitting has answered. */
  phase: 'searching' | 'idle' | 'following';
  sitting: Sitting | null;
  /** In time order. */
  readings: StoredReading[];
  /** Reference readings the server already had when this page found the sitting. */
  storedReference: ReferenceReading[];
  error: ApiError | null;
}

type Action =
  | { type: 'found'; detail: SittingDetailResponse | null }
  | { type: 'started'; sitting: Sitting }
  | { type: 'reading'; sittingId: string; reading: StoredReading }
  | { type: 'finished'; sitting: Sitting }
  | { type: 'failed'; error: ApiError };

const initial: FollowedSitting = { phase: 'searching', sitting: null, readings: [], storedReference: [], error: null };

function reduce(state: FollowedSitting, action: Action): FollowedSitting {
  switch (action.type) {
    case 'found':
      if (!action.detail) return state.sitting ? { ...state, error: null } : { ...initial, phase: 'idle' };
      return {
        phase: 'following',
        sitting: action.detail.sitting,
        readings: action.detail.readings,
        storedReference: action.detail.referenceReadings,
        error: null,
      };
    case 'started':
      return { phase: 'following', sitting: action.sitting, readings: [], storedReference: [], error: null };
    case 'reading': {
      if (state.sitting?.id !== action.sittingId) return state;
      if (state.readings.some((reading) => reading.t === action.reading.t)) return state;
      return { ...state, readings: [...state.readings, action.reading] };
    }
    case 'finished':
      return state.sitting?.id === action.sitting.id ? { ...state, sitting: action.sitting } : state;
    case 'failed':
      return { ...state, phase: state.phase === 'searching' ? 'idle' : state.phase, error: action.error };
  }
}

/** The sitting running on this device now, with what the server already holds for it. */
async function findSitting(deviceId: string, currentId: string | null): Promise<SittingDetailResponse | null> {
  const { items } = await api.worklist();
  for (const item of items.filter((candidate) => candidate.sittingInProgress)) {
    const ticket = await api.ticket(item.ticketNumber);
    const running = ticket.sittings.find((sitting) => sitting.endedAt === null && sitting.deviceId === deviceId);
    if (running) return api.sitting(running.id);
  }
  // Nothing is running. If this page was following a sitting, it has ended: fetch how.
  return currentId ? api.sitting(currentId) : null;
}

/**
 * Follows the sittings of one camera phone: finds the one that is running, then keeps up with
 * it through the readings stream. Mount it with `key={deviceId}` so a new phone starts clean.
 */
export function useFollowedSitting(deviceId: string): FollowedSitting & { retry: () => void } {
  const [state, dispatch] = useReducer(reduce, initial);
  const currentId = state.sitting?.id ?? null;

  const settle = useCallback((request: Promise<SittingDetailResponse | null>) => {
    request.then(
      (detail) => dispatch({ type: 'found', detail }),
      (error: unknown) =>
        dispatch({
          type: 'failed',
          error: error instanceof ApiError ? error : new ApiError('bad_response', 'The sitting could not be loaded.'),
        }),
    );
  }, []);
  const look = useCallback((following: string | null) => settle(findSitting(deviceId, following)), [deviceId, settle]);

  useEffect(() => look(null), [look]);

  useLiveEvents((event) => {
    if (event.type === 'sitting_started' && event.sitting.deviceId === deviceId) dispatch({ type: 'started', sitting: event.sitting });
    else if (event.type === 'reading') dispatch({ type: 'reading', sittingId: event.sittingId, reading: event.reading });
    else if (event.type === 'sitting_finished') {
      dispatch({ type: 'finished', sitting: event.sitting });
      // The stream carries readings only. Fetch the finished sitting for the reference
      // readings the server holds, which may have come from somewhere other than this page.
      if (event.sitting.id === currentId) settle(api.sitting(event.sitting.id));
    }
    else if (event.type === 'reconnected') look(currentId);
  });

  return { ...state, retry: () => look(currentId) };
}
