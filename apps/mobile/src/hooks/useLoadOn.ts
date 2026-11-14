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
 * still in the air is not overlapped: the task runs once more when it lands, so a change that
 * arrived in the meantime is not missed.
 */
export function useLoadOn(task: () => Promise<void>, key: unknown, { enabled = true, everyMs }: Options = {}): void {
  const taskRef = useRef(task);
  const running = useRef(false);
  const again = useRef(false);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        do {
          again.current = false;
          await taskRef.current();
        } while (again.current);
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
