type Write = (chunk: string | Uint8Array) => void;

/**
 * A response that stays open. `start` receives a `write` function and returns what to undo
 * when the client goes away. no-transform keeps Next.js from compressing, and so buffering,
 * the stream.
 */
export function streamResponse(request: Request, contentType: string, start: (write: Write) => () => void): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      const write: Write = (chunk) => {
        if (!open) return;
        try {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        } catch {
          close();
        }
      };
      stop = start(write);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
