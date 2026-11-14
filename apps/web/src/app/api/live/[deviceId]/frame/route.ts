import { LIVE_FRAME_HEADERS, LIVE_VIEW, LiveFrame, type PostLiveFrameResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { hashToken, sessionTokenFrom } from "@/server/auth/tokens";
import { findDevice } from "@/server/devices";
import { ApiError, idParam, readJson, route } from "@/server/http";
import { considerFrameForPhoto } from "@/server/intake";
import { postFrame, sinceLastFrame } from "@/server/live";

/** Frames arriving faster than the contract's ceiling, with slack for network jitter, are refused. */
const MIN_INTERVAL_MS = (1000 / LIVE_VIEW.maxFps) * 0.6;

/**
 * A phone posts 15 frames a second. Checking its session and its device in the database for
 * each one would put two queries in front of every picture, so a pass is remembered briefly.
 */
const PASS_MS = 10_000;
const globalForPasses = globalThis as typeof globalThis & { triagecamLivePasses?: Map<string, number> };
const passes = (globalForPasses.triagecamLivePasses ??= new Map());

async function authorise(request: Request, deviceId: string): Promise<void> {
  const token = sessionTokenFrom(request.headers);
  const key = token ? `${hashToken(token)}:${deviceId}` : null;
  const now = Date.now();
  if (key && (passes.get(key) ?? 0) > now) return;

  const session = await requireSession(request);
  const device = await findDevice(deviceId);
  if (device.userId !== session.user.id || device.role !== "camera") {
    throw new ApiError("forbidden", "Only your own camera device can post live-view frames");
  }
  if (key) {
    if (passes.size > 200) passes.clear();
    passes.set(key, Math.min(now + PASS_MS, session.expiresAt.getTime()));
  }
}

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
  await authorise(request, deviceId);
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
