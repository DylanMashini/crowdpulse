import { requireSession } from "@/server/auth/session";
import { findDevice } from "@/server/devices";
import { idParam, route } from "@/server/http";
import { watch } from "@/server/live";
import { streamResponse } from "@/server/streaming";

const BOUNDARY = "frame";

export const GET = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/stream">) => {
  await requireSession(request);
  const device = await findDevice(idParam((await context.params).deviceId, "device"));
  return streamResponse(request, `multipart/x-mixed-replace; boundary=${BOUNDARY}`, (write) => {
    write(`--${BOUNDARY}\r\n`);
    // The boundary after each picture tells the browser the picture is complete, so it is
    // shown at once and not when the next one arrives.
    return watch(device.id, (jpeg) => {
      write(`Content-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`);
      write(jpeg);
      write(`\r\n--${BOUNDARY}\r\n`);
    });
  });
});
