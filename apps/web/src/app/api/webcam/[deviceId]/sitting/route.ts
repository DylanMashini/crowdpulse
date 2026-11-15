import { WebcamSittingRequest, type WebcamSittingResponse } from "@triagecam/contracts";

import { idParam, readJson, route } from "@/server/http";
import { authoriseCamera } from "@/server/live-auth";
import { abandonWebcamSitting, finishWebcamSitting, startWebcamSitting } from "@/server/webcam";

/**
 * The engine's side of a webcam sitting. The sitting itself is made, fed its readings and
 * finished on the sittings routes, by the browser, exactly as a phone does it: `start` follows
 * POST /api/sittings, and the summary `finish` returns is the body of the finish request.
 */
export const POST = route(async (request: Request, context: RouteContext<"/api/webcam/[deviceId]/sitting">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  const { action, sittingId } = await readJson(request, WebcamSittingRequest);
  let answer: WebcamSittingResponse = { summary: null, endedAt: null, readings: [] };
  if (action === "start") await startWebcamSitting(deviceId, sittingId);
  else if (action === "finish") answer = await finishWebcamSitting(deviceId, sittingId);
  else abandonWebcamSitting(deviceId, sittingId);
  return Response.json(answer satisfies WebcamSittingResponse);
});
