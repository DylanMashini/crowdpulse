import { LIVE_FRAME_HEADERS } from '@triagecam/contracts';

/** One picture of the live view, as it came off the stream. */
export interface FeedFrame {
  jpeg: Uint8Array<ArrayBuffer>;
  /** Server clock when the phone's frame reached the server, in ms. Null if the part did not say. */
  receivedAt: number | null;
  /** Phone clock when the frame was captured, in ms. Null if the phone did not say. */
  capturedAt: number | null;
  sequence: number | null;
}

const HEADER_END = [0x0d, 0x0a, 0x0d, 0x0a];
const decoder = new TextDecoder();

function indexOfHeaderEnd(bytes: Uint8Array, from: number): number {
  for (let index = from; index <= bytes.length - 4; index++) {
    if (bytes[index] === HEADER_END[0] && bytes[index + 1] === HEADER_END[1] && bytes[index + 2] === HEADER_END[2] && bytes[index + 3] === HEADER_END[3]) {
      return index;
    }
  }
  return -1;
}

const numberOrNull = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : null;
};

/**
 * Cuts a multipart/x-mixed-replace byte stream into its JPEG parts. Feed it chunks as they
 * arrive; it calls `onFrame` for each complete picture. Every part carries a Content-Length,
 * so a JPEG is never searched for a boundary.
 */
export function createPartParser(onFrame: (frame: FeedFrame) => void): (chunk: Uint8Array) => void {
  let pending = new Uint8Array(new ArrayBuffer(0));

  return (chunk) => {
    const joined = new Uint8Array(new ArrayBuffer(pending.length + chunk.length));
    joined.set(pending, 0);
    joined.set(chunk, pending.length);
    pending = joined;

    let offset = 0;
    for (;;) {
      const headerEnd = indexOfHeaderEnd(pending, offset);
      if (headerEnd === -1) break;
      const headers = new Map<string, string>();
      for (const line of decoder.decode(pending.subarray(offset, headerEnd)).split('\r\n')) {
        const colon = line.indexOf(':');
        if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
      }
      const length = numberOrNull(headers.get('content-length'));
      if (length === null) {
        // Not a part this reader understands: skip its headers and look for the next one.
        offset = headerEnd + 4;
        continue;
      }
      const start = headerEnd + 4;
      if (pending.length < start + length) break;
      onFrame({
        jpeg: pending.slice(start, start + length),
        receivedAt: numberOrNull(headers.get(LIVE_FRAME_HEADERS.receivedAt)),
        capturedAt: numberOrNull(headers.get(LIVE_FRAME_HEADERS.capturedAt)),
        sequence: numberOrNull(headers.get(LIVE_FRAME_HEADERS.sequence)),
      });
      offset = start + length;
    }
    pending = pending.slice(offset);
  };
}

export interface FeedHandlers {
  onFrame: (frame: FeedFrame) => void;
  /** The stream opened, or closed and is being opened again. */
  onConnection: (open: boolean) => void;
}

const RETRY_AFTER_MS = 1000;

/**
 * Reads a camera phone's live view for as long as the returned function has not been called.
 * A stream that ends or fails is opened again a second later.
 */
export function readLiveFeed(url: string, handlers: FeedHandlers): () => void {
  const abort = new AbortController();
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`The live view answered ${response.status}`);
      handlers.onConnection(true);
      const parse = createPartParser(handlers.onFrame);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(value);
      }
    } catch {
      // Aborted, or the connection dropped. Either way the loop below decides what is next.
    }
    if (abort.signal.aborted) return;
    handlers.onConnection(false);
    retry = setTimeout(connect, RETRY_AFTER_MS);
  };
  void connect();

  return () => {
    abort.abort();
    if (retry) clearTimeout(retry);
  };
}
