import { LIVE_VIEW, LiveFrame, type PostLiveFrameResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { findDevice } from "@/server/devices";
import { ApiError, idParam, readJson, route } from "@/server/http";
import { postFrame, sinceLastFrame } from "@/server/live";

/** Frames arriving faster than the contract's rate, with some slack for network jitter, are refused. */
const MIN_INTERVAL_MS = (1000 / LIVE_VIEW.maxFps) * 0.6;

export const POST = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/frame">) => {
  const session = await requireSession(request);
  const device = await findDevice(idParam((await context.params).deviceId, "device"));
  if (device.userId !== session.user.id || device.role !== "camera") {
    throw new ApiError("forbidden", "Only your own camera device can post live-view frames");
  }
  const since = sinceLastFrame(device.id);
  if (since !== null && since < MIN_INTERVAL_MS) {
    throw new ApiError("rate_limited", `The live view takes at most ${LIVE_VIEW.maxFps} frames per second`);
  }
  const frame = await readJson(request, LiveFrame);
  const jpeg = Buffer.from(frame.jpegBase64, "base64");
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new ApiError("invalid_request", "jpegBase64 is not a JPEG image");
  return Response.json({ viewers: postFrame(device.id, jpeg) } satisfies PostLiveFrameResponse);
});
