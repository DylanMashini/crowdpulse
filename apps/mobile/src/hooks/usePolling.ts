import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Calls `task` now and then every `intervalMs` while `enabled` and the app is in the
 * foreground, and once more whenever `refreshKey` changes. A call that is still running is
 * never overlapped by the next one.
 */
export function usePolling(
  task: () => Promise<void>,
  intervalMs: number,
  enabled: boolean,
  refreshKey: number = 0,
): void {
  const taskRef = useRef(task);
  const running = useRef(false);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const tickRef = useRef(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await taskRef.current();
    } finally {
      running.current = false;
    }
  });

  useEffect(() => {
    if (enabled && refreshKey > 0) void tickRef.current();
  }, [enabled, refreshKey]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = tickRef.current;
    const start = () => {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (next) => (next === 'active' ? start() : stop()));
    return () => {
      subscription.remove();
      stop();
    };
  }, [intervalMs, enabled]);
}
