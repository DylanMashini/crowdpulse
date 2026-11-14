import { LIVE_VIEW } from "@triagecam/contracts";

import { publish } from "./events.ts";

/** One relayed picture. `capturedAt` is on the phone's clock; `receivedAt` is this server's. */
export type RelayedFrame = { jpeg: Buffer; capturedAt: number | null; receivedAt: number; sequence: number };
type Viewer = (frame: RelayedFrame) => void;
type Channel = { frame: RelayedFrame | null; sequence: number; viewers: Set<Viewer>; expiry?: NodeJS.Timeout };

// The live view lives here and nowhere else: the newest frame per device, in memory. Frames
// are never written to disk, to the database or to the log. (The one deliberate exception is
// in intake.ts: a single frame per patient is cropped into the profile photo.)
const globalForLive = globalThis as typeof globalThis & { triagecamLiveChannels?: Map<string, Channel> };
const channels = (globalForLive.triagecamLiveChannels ??= new Map());

function channel(deviceId: string): Channel {
  let found = channels.get(deviceId);
  if (!found) {
    found = { frame: null, sequence: 0, viewers: new Set() };
    channels.set(deviceId, found);
  }
  return found;
}

function release(deviceId: string, target: Channel): void {
  if (target.frame === null && target.viewers.size === 0) channels.delete(deviceId);
}

/** Milliseconds since the device's previous frame, or null when it is not live. */
export function sinceLastFrame(deviceId: string, now = Date.now()): number | null {
  const found = channels.get(deviceId);
  return found?.frame ? now - found.frame.receivedAt : null;
}

/** Replaces the device's frame and hands it to everyone watching. Returns the viewer count. */
export function postFrame(deviceId: string, jpeg: Buffer, capturedAt: number | null = null): number {
  const target = channel(deviceId);
  const wasLive = target.frame !== null;
  target.sequence += 1;
  const frame: RelayedFrame = { jpeg, capturedAt, receivedAt: Date.now(), sequence: target.sequence };
  target.frame = frame;
  clearTimeout(target.expiry);
  target.expiry = setTimeout(() => {
    target.frame = null;
    publish({ type: "live_changed", deviceId, live: false });
    release(deviceId, target);
  }, LIVE_VIEW.timeoutMs);
  if (!wasLive) publish({ type: "live_changed", deviceId, live: true });
  for (const viewer of target.viewers) viewer(frame);
  return target.viewers.size;
}

/** When the device last posted a frame, if that was within the live-view timeout. */
export function liveAt(deviceId: string): Date | null {
  const found = channels.get(deviceId);
  return found?.frame ? new Date(found.frame.receivedAt) : null;
}

/** The frame the device is showing right now, if it is live. */
export function currentFrame(deviceId: string): RelayedFrame | null {
  return channels.get(deviceId)?.frame ?? null;
}

/** Calls `viewer` with the current frame, if there is one, and with every frame after it. */
export function watch(deviceId: string, viewer: Viewer): () => void {
  const target = channel(deviceId);
  target.viewers.add(viewer);
  if (target.frame) viewer(target.frame);
  return () => {
    target.viewers.delete(viewer);
    release(deviceId, target);
  };
}
