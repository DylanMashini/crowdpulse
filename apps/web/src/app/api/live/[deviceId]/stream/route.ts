import { LIVE_FRAME_HEADERS } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { findDevice } from "@/server/devices";
import { idParam, route } from "@/server/http";
import { type RelayedFrame, watch } from "@/server/live";

const BOUNDARY = "frame";
const encoder = new TextEncoder();

/** One multipart part: its headers, the JPEG, and the boundary that tells the reader it is complete. */
function part(frame: RelayedFrame): Uint8Array {
  const head = encoder.encode(
    `Content-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.byteLength}\r\n` +
      (frame.capturedAt === null ? "" : `${LIVE_FRAME_HEADERS.capturedAt}: ${frame.capturedAt}\r\n`) +
      (frame.regions === null ? "" : `${LIVE_FRAME_HEADERS.regions}: ${frame.regions}\r\n`) +
      `${LIVE_FRAME_HEADERS.receivedAt}: ${frame.receivedAt}\r\n` +
      `${LIVE_FRAME_HEADERS.sequence}: ${frame.sequence}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${BOUNDARY}\r\n`);
  const bytes = new Uint8Array(head.byteLength + frame.jpeg.byteLength + tail.byteLength);
  bytes.set(head, 0);
  bytes.set(frame.jpeg, head.byteLength);
  bytes.set(tail, head.byteLength + frame.jpeg.byteLength);
  return bytes;
}

/**
 * The live view of one camera phone as multipart/x-mixed-replace, which an <img> shows as it
 * is and which the dashboard reads part by part. A reader that falls behind does not get a
 * backlog: only the newest frame waits for it, so what it sees is always current.
 */
export const GET = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/stream">) => {
  await requireSession(request);
  const device = await findDevice(idParam((await context.params).deviceId, "device"));

  let waiting: RelayedFrame | null = null;
  let unwatch = () => {};
  // Sends the waiting frame if the reader has room for it. Set in start(), which has the controller.
  let send = () => {};
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(encoder.encode(`--${BOUNDARY}\r\n`));
        send = () => {
          if (!waiting || (controller.desiredSize ?? 0) <= 0) return;
          const frame = waiting;
          waiting = null;
          try {
            controller.enqueue(part(frame));
          } catch {
            unwatch();
          }
        };
        unwatch = watch(device.id, (frame) => {
          waiting = frame;
          send();
        });
        request.signal.addEventListener(
          "abort",
          () => {
            unwatch();
            try {
              controller.close();
            } catch {
              // Already closed by the client.
            }
          },
          { once: true },
        );
      },
      // The reader took a part: the frame that arrived while it was busy goes out now, not
      // when the phone sends the next one.
      pull() {
        send();
      },
      cancel() {
        unwatch();
      },
    },
    // Two parts may queue: the one being written to the socket and the one after it.
    new CountQueuingStrategy({ highWaterMark: 2 }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
