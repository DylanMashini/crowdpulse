import { PollWebcamRequest, type PollWebcamResponse } from "@triagecam/contracts";

import { idParam, readJson, route } from "@/server/http";
import { viewerCount } from "@/server/live";
import { authoriseCamera } from "@/server/live-auth";
import { pollNativeWebcam } from "@/server/webcam";

/**
 * The check-in page asking after the camera this server opens itself. No frame comes from the
 * browser: the first call turns the Mac's camera on, and each answer says what the engine has
 * made of its frames. The picture reaches the page over the live view, as a phone's does.
 */
export const POST = route(async (request: Request, context: RouteContext<"/api/webcam/[deviceId]/native">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  const { readingsAfter, snapshot } = await readJson(request, PollWebcamRequest);
  const answer = pollNativeWebcam(deviceId, viewerCount(deviceId), readingsAfter, snapshot);
  return Response.json(answer satisfies PollWebcamResponse);
});
