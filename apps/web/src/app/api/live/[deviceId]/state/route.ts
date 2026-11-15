import { PostLiveStateRequest, type PostLiveStateResponse } from "@triagecam/contracts";

import { noteDeviceSeen } from "@/server/devices";
import { idParam, readJson, route } from "@/server/http";
import { reportState } from "@/server/live";
import { authoriseCamera } from "@/server/live-auth";

/**
 * The phone's side of the check-in page: what its screen is doing and the outlines it is
 * measuring on, several times a second with the camera on and once a second without. The
 * answer hands over the dashboard's command, if one is waiting.
 */
export const POST = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/state">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  const { state, regions } = await readJson(request, PostLiveStateRequest);
  noteDeviceSeen(deviceId);
  return Response.json(reportState(deviceId, state, regions) satisfies PostLiveStateResponse);
});
