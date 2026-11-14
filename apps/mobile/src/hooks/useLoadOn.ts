import { useEffect, useRef } from 'react';

type Options = {
  /** False holds the loading off, for a screen that is covered or has nothing to ask for. */
  enabled?: boolean;
  /** Also load again this often, as a net under the server's change events. */
  everyMs?: number;
};

/**
 * Runs `task` when the screen mounts and again whenever `key` changes: screens pass the nurse
 * provider's `revision`, which goes up each time the server reports a change. A run that is
 * still in the air is not overlapped by the next one.
 */
export function useLoadOn(task: () => Promise<void>, key: unknown, { enabled = true, everyMs }: Options = {}): void {
  const taskRef = useRef(task);
  const running = useRef(false);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        await taskRef.current();
      } finally {
        running.current = false;
      }
    };
    void run();
    if (!everyMs) return;
    const timer = setInterval(() => void run(), everyMs);
    return () => clearInterval(timer);
  }, [key, enabled, everyMs]);
}
