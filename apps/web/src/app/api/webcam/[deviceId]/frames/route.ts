import { LIVE_VIEW, WEBCAM, WEBCAM_FRAME_HEADERS, WEBCAM_FRAME_PREFIX_BYTES, type PostWebcamFramesResponse } from "@triagecam/contracts";

import { ApiError, idParam, route } from "@/server/http";
import { considerFrameForPhoto } from "@/server/intake";
import { postFrame, sinceLastFrame, viewerCount } from "@/server/live";
import { authoriseCamera } from "@/server/live-auth";
import { feedFrames } from "@/server/webcam";
import { parseFrames, type WebcamFrame } from "@/server/webcam-wire";

const MAX_BODY_BYTES = WEBCAM.maxQueuedFrames * (WEBCAM.maxFrameBytes + WEBCAM_FRAME_PREFIX_BYTES);
/** The live view takes the webcam's frames at a phone's rate, with slack for uneven arrival. */
const RELAY_INTERVAL_MS = (1000 / LIVE_VIEW.fps) * 0.8;

/**
 * The check-in page's webcam: the frames taken since its last request, in order. Each goes to
 * the engine; the newest also goes to the live view and the profile photo, as a phone's
 * live-view frame does, so the picture, the outlines and the photo work as they do for a phone.
 */
export const POST = route(async (request: Request, context: RouteContext<"/api/webcam/[deviceId]/frames">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  const tooLarge = new ApiError("payload_too_large", "Too many webcam frames in one request");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge;
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) throw tooLarge;
  const frames = parseFrames(body);

  const newest = frames[frames.length - 1] as WebcamFrame;
  const since = sinceLastFrame(deviceId);
  if (since === null || since >= RELAY_INTERVAL_MS) {
    postFrame(deviceId, newest.jpeg, newest.capturedAtMs);
    considerFrameForPhoto(deviceId, newest.jpeg);
  }
  const count = (header: string) => {
    const parsed = Number(request.headers.get(header) ?? 0);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  const answer = feedFrames(deviceId, frames, count(WEBCAM_FRAME_HEADERS.dropped), viewerCount(deviceId), count(WEBCAM_FRAME_HEADERS.readingsAfter));
  return Response.json(answer satisfies PostWebcamFramesResponse);
});
