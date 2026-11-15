import { idParam, noContent, route } from "@/server/http";
import { authoriseCamera } from "@/server/live-auth";
import { closeWebcam } from "@/server/webcam";

/** The webcam is off: its engine process stops. Left alone, the process stops by itself after 15 seconds without a frame. */
export const DELETE = route(async (request: Request, context: RouteContext<"/api/webcam/[deviceId]">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  closeWebcam(deviceId);
  return noContent();
});
