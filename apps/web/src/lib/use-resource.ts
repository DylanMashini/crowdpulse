import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api';

export interface Resource<T> {
  /** The last good answer. Kept while a refresh runs or fails, so a screen never blanks. */
  data: T | null;
  error: ApiError | null;
  /** True until the first answer or error. */
  loading: boolean;
  /** Browser clock when `data` arrived. */
  updatedAt: number | null;
  reload: () => void;
}

interface State<T> {
  key: string;
  data: T | null;
  error: ApiError | null;
  updatedAt: number | null;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError('bad_response', 'Something went wrong on this page. Reload and try again.');
}

/**
 * Loads one thing and keeps it. `key` names what is loaded: when it changes the old data is
 * dropped and the new thing is fetched. Pass null to load nothing.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<State<T>>({ key: '', data: null, error: null, updatedAt: null });
  const loadRef = useRef(load);
  const latest = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback((forKey: string) => {
    const attempt = ++latest.current;
    loadRef.current().then(
      (data) => {
        if (attempt === latest.current) setState({ key: forKey, data, error: null, updatedAt: Date.now() });
      },
      (error: unknown) => {
        if (attempt !== latest.current) return;
        setState((previous) => ({
          key: forKey,
          data: previous.key === forKey ? previous.data : null,
          error: toApiError(error),
          updatedAt: previous.key === forKey ? previous.updatedAt : null,
        }));
      },
    );
  }, []);

  useEffect(() => {
    if (key !== null) run(key);
  }, [key, run]);

  const reload = useCallback(() => {
    if (key !== null) run(key);
  }, [key, run]);

  const current = key !== null && state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && !current,
    updatedAt: current ? state.updatedAt : null,
    reload,
  };
}
