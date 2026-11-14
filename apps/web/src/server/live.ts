import { randomUUID } from "node:crypto";

import { LIVE_VIEW, type CameraCommand, type CameraState, type LiveRegions, type SendCameraCommandRequest } from "@triagecam/contracts";

import { publish } from "./events.ts";
import { ApiError } from "./http.ts";

/**
 * One relayed picture. `capturedAt` is on the phone's clock; `receivedAt` is this server's.
 * `regions` is the JSON of the outlines the phone reported for about this moment, or null.
 */
export type RelayedFrame = { jpeg: Buffer; capturedAt: number | null; receivedAt: number; sequence: number; regions: string | null };
type Viewer = (frame: RelayedFrame) => void;
/** What the phone last said about itself, the outlines it is measuring on, and a command waiting for it. */
type Station = {
  state: CameraState;
  /** `state` as JSON: a report that says the same thing again is not published again. */
  stateKey: string;
  regions: string | null;
  regionsAt: number;
  command: CameraCommand | null;
  commandExpiry?: NodeJS.Timeout;
  expiry?: NodeJS.Timeout;
};
type Channel = { frame: RelayedFrame | null; sequence: number; viewers: Set<Viewer>; expiry?: NodeJS.Timeout; station?: Station | null };

// The live view lives here and nowhere else: the newest frame per device, in memory. Frames
// are never written to disk, to the database or to the log. (The one deliberate exception is
// in intake.ts: a single frame per patient is cropped into the profile photo.) The phone's
// state, its outlines and a command on its way to it are kept the same way.
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
  if (target.frame === null && target.viewers.size === 0 && !target.station) channels.delete(deviceId);
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
  const receivedAt = Date.now();
  const station = target.station;
  // The outlines ride on the picture they belong to, so the dashboard draws both together.
  const regions = station?.regions && receivedAt - station.regionsAt <= LIVE_VIEW.regionsMaxAgeMs ? station.regions : null;
  const frame: RelayedFrame = { jpeg, capturedAt, receivedAt, sequence: target.sequence, regions };
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

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const roundPoints = (points: { x: number; y: number }[] | null) => points?.map((point) => ({ x: round(point.x), y: round(point.y) })) ?? null;
const roundRect = (rect: { x: number; y: number; width: number; height: number } | null) =>
  rect ? { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } : null;

/** The outlines as the header of a stream part: four decimals are a tenth of a pixel on a 640 px frame. */
function regionsHeader(regions: LiveRegions | null): string | null {
  if (!regions || !regions.face) return null;
  return JSON.stringify({
    aspectRatio: round(regions.aspectRatio),
    face: roundRect(regions.face),
    forehead: roundPoints(regions.forehead),
    leftCheek: roundPoints(regions.leftCheek),
    rightCheek: roundPoints(regions.rightCheek),
    chest: roundRect(regions.chest),
  } satisfies LiveRegions);
}

function dropStation(deviceId: string, target: Channel): void {
  const station = target.station;
  if (!station) return;
  clearTimeout(station.expiry);
  clearTimeout(station.commandExpiry);
  target.station = null;
  publish({ type: "camera_state", deviceId, state: null });
  release(deviceId, target);
}

/**
 * The phone's report: what its screen is doing and, with the camera on, the outlines it is
 * measuring on. Kept in memory like the frames. Returns the dashboards watching and the
 * command that was waiting for the phone, which is handed over once.
 */
export function reportState(deviceId: string, state: CameraState, regions: LiveRegions | null): { viewers: number; command: CameraCommand | null } {
  const target = channel(deviceId);
  const stateKey = JSON.stringify(state);
  const station: Station = target.station ?? { state, stateKey: "", regions: null, regionsAt: 0, command: null };
  station.state = state;
  station.regions = regionsHeader(regions);
  station.regionsAt = Date.now();
  clearTimeout(station.expiry);
  station.expiry = setTimeout(() => dropStation(deviceId, target), LIVE_VIEW.stateTimeoutMs);
  target.station = station;
  if (station.stateKey !== stateKey) {
    station.stateKey = stateKey;
    publish({ type: "camera_state", deviceId, state });
  }
  const command = station.command;
  station.command = null;
  clearTimeout(station.commandExpiry);
  return { viewers: target.viewers.size, command };
}

/** What the phone last said about itself, if it is still reporting. */
export function cameraState(deviceId: string): CameraState | null {
  return channels.get(deviceId)?.station?.state ?? null;
}

const RUNNING: ReadonlySet<CameraState["phase"]> = new Set(["starting", "running", "stopping"]);

/**
 * Leaves a command for the phone to collect with its next report. Refused when the phone is
 * not reporting, or is not in a state to carry it out. Asking twice for the same thing
 * before the phone has collected it is one command.
 */
export function sendCommand(deviceId: string, label: string, request: SendCameraCommandRequest): CameraCommand {
  const station = channels.get(deviceId)?.station;
  if (!station) throw new ApiError("camera_offline", `${label} is not connected. Open Crowdpulse on it in the camera role.`);
  const { phase } = station.state;
  if (request.type === "open" && RUNNING.has(phase)) throw new ApiError("camera_busy", `A sitting is running on ${label}`);
  if (request.type === "start" && phase !== "framing") {
    throw new ApiError("camera_busy", RUNNING.has(phase) ? `A sitting is already running on ${label}` : `${label} is not ready to start a sitting`);
  }
  if (request.type === "stop" && phase !== "running") throw new ApiError("camera_busy", `No sitting is running on ${label}`);
  if (request.type === "cancel" && phase === "idle") throw new ApiError("camera_busy", `No check-in is open on ${label}`);

  const waiting = station.command;
  if (waiting && waiting.type === request.type && waiting.patientNumber === (request.patientNumber ?? null)) return waiting;
  const command: CameraCommand = {
    id: randomUUID(),
    type: request.type,
    patientNumber: request.type === "open" ? (request.patientNumber ?? null) : null,
    kind: request.type === "open" ? (request.kind ?? null) : null,
    enrolFace: request.type === "start" && request.enrolFace === true,
  };
  station.command = command;
  clearTimeout(station.commandExpiry);
  station.commandExpiry = setTimeout(() => {
    if (station.command === command) station.command = null;
  }, LIVE_VIEW.commandTimeoutMs);
  return command;
}
