import { requireSession } from "./auth/session.ts";
import { hashToken, sessionTokenFrom } from "./auth/tokens.ts";
import { findDevice } from "./devices.ts";
import { ApiError } from "./http.ts";

/**
 * A phone posts 15 frames and up to 10 state reports a second. Checking its session and its
 * device in the database for each one would put two queries in front of every picture, so a
 * pass is remembered briefly.
 */
const PASS_MS = 10_000;
const globalForPasses = globalThis as typeof globalThis & { triagecamLivePasses?: Map<string, number> };
const passes = (globalForPasses.triagecamLivePasses ??= new Map());

/** Lets the request through only when it comes from the signed-in owner of this camera device. */
export async function authoriseCamera(request: Request, deviceId: string): Promise<void> {
  const token = sessionTokenFrom(request.headers);
  const key = token ? `${hashToken(token)}:${deviceId}` : null;
  const now = Date.now();
  if (key && (passes.get(key) ?? 0) > now) return;

  const session = await requireSession(request);
  const device = await findDevice(deviceId);
  if (device.userId !== session.user.id || device.role !== "camera") {
    throw new ApiError("forbidden", "Only your own camera device can post to the live view");
  }
  if (key) {
    if (passes.size > 200) passes.clear();
    passes.set(key, Math.min(now + PASS_MS, session.expiresAt.getTime()));
  }
}
