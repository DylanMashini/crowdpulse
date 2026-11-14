import { StreamEvent, routes, type StreamEventType } from '@triagecam/contracts';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void;
  onStatus: (status: StreamStatus) => void;
}

const EVENT_TYPES: StreamEventType[] = [
  'reading',
  'sitting_started',
  'sitting_finished',
  'flag_opened',
  'flag_acknowledged',
  'flag_closed',
  'worklist_changed',
  'ticket_changed',
  'live_changed',
];

/** EventSource gives up for good on an HTTP error (a 401, a restart). Try again after this long. */
const REOPEN_AFTER_MS = 5000;

function openEventSource({ onEvent, onStatus }: StreamHandlers): () => void {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () => {
    source = new EventSource(routes.stream);
    source.onopen = () => onStatus('open');
    source.onerror = () => {
      onStatus('reconnecting');
      if (source?.readyState === EventSource.CLOSED && !closed) {
        retry = setTimeout(connect, REOPEN_AFTER_MS);
      }
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        try {
          const parsed = StreamEvent.safeParse(JSON.parse((message as MessageEvent<string>).data));
          if (parsed.success) onEvent(parsed.data);
        } catch {
          // A line that is not JSON carries nothing this page can use.
        }
      });
    }
  };

  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
}

/** Opens GET /api/stream. Events are not replayed, so refetch whenever status returns to open. */
export function openStream(handlers: StreamHandlers): () => void {
  if (process.env.NEXT_PUBLIC_API_MOCK === '1') {
    let close = () => {};
    let cancelled = false;
    void import('./mock/server').then(({ openMockStream }) => {
      if (!cancelled) close = openMockStream(handlers);
    });
    return () => {
      cancelled = true;
      close();
    };
  }
  return openEventSource(handlers);
}
