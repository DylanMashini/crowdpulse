import { LIVE_VIEW } from "@triagecam/contracts";

import { publish } from "./events.ts";

type Viewer = (jpeg: Buffer) => void;
type Channel = { jpeg: Buffer | null; at: number; viewers: Set<Viewer>; expiry?: NodeJS.Timeout };

// The live view lives here and nowhere else: the newest frame per device, in memory. Frames
// are never written to disk, to the database or to the log.
const globalForLive = globalThis as typeof globalThis & { triagecamLive?: Map<string, Channel> };
const channels = (globalForLive.triagecamLive ??= new Map());

function channel(deviceId: string): Channel {
  let found = channels.get(deviceId);
  if (!found) {
    found = { jpeg: null, at: 0, viewers: new Set() };
    channels.set(deviceId, found);
  }
  return found;
}

function release(deviceId: string, target: Channel): void {
  if (target.jpeg === null && target.viewers.size === 0) channels.delete(deviceId);
}

/** Milliseconds since the device's previous frame, or null when it is not live. */
export function sinceLastFrame(deviceId: string, now = Date.now()): number | null {
  const found = channels.get(deviceId);
  return found?.jpeg ? now - found.at : null;
}

/** Replaces the device's frame and hands it to everyone watching. Returns the viewer count. */
export function postFrame(deviceId: string, jpeg: Buffer): number {
  const target = channel(deviceId);
  const wasLive = target.jpeg !== null;
  target.jpeg = jpeg;
  target.at = Date.now();
  clearTimeout(target.expiry);
  target.expiry = setTimeout(() => {
    target.jpeg = null;
    publish({ type: "live_changed", deviceId, live: false });
    release(deviceId, target);
  }, LIVE_VIEW.timeoutMs);
  if (!wasLive) publish({ type: "live_changed", deviceId, live: true });
  for (const viewer of target.viewers) viewer(jpeg);
  return target.viewers.size;
}

/** When the device last posted a frame, if that was within the live-view timeout. */
export function liveAt(deviceId: string): Date | null {
  const found = channels.get(deviceId);
  return found?.jpeg ? new Date(found.at) : null;
}

/** Calls `viewer` with the current frame, if there is one, and with every frame after it. */
export function watch(deviceId: string, viewer: Viewer): () => void {
  const target = channel(deviceId);
  target.viewers.add(viewer);
  if (target.jpeg) viewer(target.jpeg);
  return () => {
    target.viewers.delete(viewer);
    release(deviceId, target);
  };
}
