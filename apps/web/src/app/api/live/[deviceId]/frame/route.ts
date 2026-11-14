import { LIVE_FRAME_HEADERS, LIVE_VIEW, LiveFrame, type PostLiveFrameResponse } from "@triagecam/contracts";

import { ApiError, idParam, readJson, route } from "@/server/http";
import { considerFrameForPhoto } from "@/server/intake";
import { postFrame, sinceLastFrame } from "@/server/live";
import { authoriseCamera } from "@/server/live-auth";

/** Frames arriving faster than the contract's ceiling, with slack for network jitter, are refused. */
const MIN_INTERVAL_MS = (1000 / LIVE_VIEW.maxFps) * 0.6;

const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/** The picture and the phone's capture time, from either form of the request. */
async function readFrame(request: Request): Promise<{ jpeg: Buffer; capturedAt: number | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/jpeg")) {
    if (Number(request.headers.get("content-length") ?? 0) > LIVE_VIEW.maxFrameBytes) {
      throw new ApiError("payload_too_large", "A live-view frame is at most 300 kB");
    }
    const jpeg = Buffer.from(await request.arrayBuffer());
    if (jpeg.byteLength > LIVE_VIEW.maxFrameBytes) throw new ApiError("payload_too_large", "A live-view frame is at most 300 kB");
    const capturedAt = Number(request.headers.get(LIVE_FRAME_HEADERS.capturedAt));
    return { jpeg, capturedAt: Number.isFinite(capturedAt) && capturedAt > 0 ? capturedAt : null };
  }
  const frame = await readJson(request, LiveFrame);
  return { jpeg: Buffer.from(frame.jpegBase64, "base64"), capturedAt: Date.parse(frame.t) };
}

export const POST = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/frame">) => {
  const deviceId = idParam((await context.params).deviceId, "device");
  await authoriseCamera(request, deviceId);
  const since = sinceLastFrame(deviceId);
  if (since !== null && since < MIN_INTERVAL_MS) {
    throw new ApiError("rate_limited", `The live view takes at most ${LIVE_VIEW.maxFps} frames per second`);
  }
  const { jpeg, capturedAt } = await readFrame(request);
  if (!isJpeg(jpeg)) throw new ApiError("invalid_request", "The frame is not a JPEG image");
  const viewers = postFrame(deviceId, jpeg, capturedAt);
  considerFrameForPhoto(deviceId, jpeg);
  return Response.json({ viewers } satisfies PostLiveFrameResponse);
});
