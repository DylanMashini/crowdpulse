import { StreamEvent, routes } from '@triagecam/contracts';
// React Native's own fetch gives the body only when it is complete. Expo's can be read as it arrives.
import { fetch as streamingFetch } from 'expo/fetch';

import { api, authHeaders } from '@/lib/api';

import { createSseParser } from './sse';

/** The server pings every 15 seconds. Two missed pings and a margin: the stream is dead. */
const SILENCE_MS = 40_000;

type Handlers = {
  /** The stream is connected and the server has answered. */
  onOpen: () => void;
  onEvent: (event: StreamEvent) => void;
  /** The stream ended or could not be opened. It does not reconnect by itself. */
  onClose: () => void;
};

/**
 * Opens GET /api/stream with the phone's bearer token and reports each event. Returns a
 * function that closes it. Events are not replayed after a gap: whoever reconnects refetches.
 */
export function openEventStream({ onOpen, onEvent, onClose }: Handlers): () => void {
  const controller = new AbortController();
  let closed = false;
  let silence: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (silence) clearTimeout(silence);
    controller.abort();
    onClose();
  };
  const heard = () => {
    if (silence) clearTimeout(silence);
    silence = setTimeout(finish, SILENCE_MS);
  };

  const parse = createSseParser((message) => {
    let event;
    try {
      event = StreamEvent.safeParse(JSON.parse(message.data));
    } catch {
      return;
    }
    // An event this build does not know is skipped: the contract only grows.
    if (event.success) onEvent(event.data);
  }, heard);

  void (async () => {
    try {
      heard();
      const response = await streamingFetch(`${api.baseUrl}${routes.stream}`, {
        headers: { ...authHeaders(), Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return finish();
      onOpen();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        heard();
        parse(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Aborted, offline, or the server went away: the caller decides when to try again.
    }
    finish();
  })();

  return () => {
    if (closed) return;
    closed = true;
    if (silence) clearTimeout(silence);
    controller.abort();
  };
}
