import { LIVE_VIEW, WEBCAM, WEBCAM_FRAME_HEADERS, WEBCAM_FRAME_PREFIX_BYTES, type PostWebcamFramesResponse } from "@triagecam/contracts";

import { ApiError, idParam, route } from "@/server/http";
import { considerFrameForPhoto } from "@/server/intake";
import { postFrame, sinceLastFrame, viewerCount } from "@/server/live";
import { authoriseCamera } from "@/server/live-auth";
import { feedFrames, type WebcamFrame } from "@/server/webcam";

const MAX_BODY_BYTES = WEBCAM.maxQueuedFrames * (WEBCAM.maxFrameBytes + WEBCAM_FRAME_PREFIX_BYTES);
/** The live view takes the webcam's frames at a phone's rate, with slack for uneven arrival. */
const RELAY_INTERVAL_MS = (1000 / LIVE_VIEW.fps) * 0.8;

const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
const count = (value: string | null) => {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

/** Cuts the body into its frames: a 12-byte prefix (capture time, length) before each JPEG. */
function readFrames(body: Buffer): WebcamFrame[] {
  const frames: WebcamFrame[] = [];
  let offset = 0;
  while (offset < body.byteLength) {
    if (offset + WEBCAM_FRAME_PREFIX_BYTES > body.byteLength) throw new ApiError("invalid_request", "The body ends inside a frame");
    const capturedAtMs = body.readDoubleLE(offset);
    const length = body.readUInt32LE(offset + 8);
    offset += WEBCAM_FRAME_PREFIX_BYTES;
    if (length > WEBCAM.maxFrameBytes) throw new ApiError("payload_too_large", "A webcam frame is at most 600 kB");
    if (offset + length > body.byteLength) throw new ApiError("invalid_request", "The body ends inside a frame");
    const jpeg = body.subarray(offset, offset + length);
    offset += length;
    if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) throw new ApiError("invalid_request", "A frame has no capture time");
    if (!isJpeg(jpeg)) throw new ApiError("invalid_request", "A frame is not a JPEG image");
    frames.push({ jpeg, capturedAtMs });
  }
  if (frames.length === 0) throw new ApiError("invalid_request", "The body holds no frame");
  return frames;
}

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
  const frames = readFrames(body);

  const newest = frames[frames.length - 1] as WebcamFrame;
  const since = sinceLastFrame(deviceId);
  if (since === null || since >= RELAY_INTERVAL_MS) {
    postFrame(deviceId, newest.jpeg, newest.capturedAtMs);
    considerFrameForPhoto(deviceId, newest.jpeg);
  }
  const answer = feedFrames(
    deviceId,
    frames,
    count(request.headers.get(WEBCAM_FRAME_HEADERS.dropped)),
    viewerCount(deviceId),
    count(request.headers.get(WEBCAM_FRAME_HEADERS.readingsAfter)),
  );
  return Response.json(answer satisfies PostWebcamFramesResponse);
});
