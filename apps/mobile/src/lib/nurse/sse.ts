// A parser for the text/event-stream format of GET /api/stream (docs/CONTRACTS.md section 4,
// Readings stream). It takes the response a chunk at a time, however the network cuts it up.

export type SseMessage = {
  /** The `event:` field; "message" when the server sent none. */
  event: string;
  /** The `data:` lines joined with newlines. */
  data: string;
};

/**
 * Returns a function to feed with decoded text. `onMessage` is called once per complete event.
 * Comment lines (the server's `: ping` every 15 seconds) call `onComment`, so the caller can
 * tell a quiet stream from a dead one.
 */
export function createSseParser(onMessage: (message: SseMessage) => void, onComment?: () => void) {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0) onMessage({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) {
      onComment?.();
      return;
    }
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.search(/\r\n|\n|\r/);
      if (end === -1) return;
      // A lone carriage return at the very end may be the first half of \r\n: wait for more.
      if (buffer[end] === '\r' && end === buffer.length - 1) return;
      const width = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, end));
      buffer = buffer.slice(end + width);
    }
  };
}
