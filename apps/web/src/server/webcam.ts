import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LiveRegions, WEBCAM, type PostWebcamFramesResponse, type Reading, type WebcamSittingResponse } from "@triagecam/contracts";

import { env, isProduction } from "./env.ts";
import { ApiError } from "./http.ts";
import { saveSittingFile, sittingDetail } from "./sittings.ts";
import { wireReading, wireSummary, type EngineReading, type WebcamFrame } from "./webcam-wire.ts";

// The check-in page's own webcam, in place of a camera phone. The browser does everything a
// phone does over the existing routes; the one thing it has no capture module for is turning
// frames into readings. That happens here: each webcam gets one `live-sitting` process
// (eval/video-to-sitting), which runs the phone's region code and the SignalEngine on the
// frames as they arrive. Nothing here invents a value: with no process there is no reading.

/** Frames handed to the process and not yet answered. Beyond this a frame is dropped, and counted. */
const MAX_PENDING = 20;
const SUMMARY_TIMEOUT_MS = 8000;
/** A sitting's readings are kept for the browser to collect; a sitting is 60 of them. */
const MAX_READINGS = 600;

type RunningSitting = {
  id: string;
  /** Where the process writes the sitting file, when one is kept. */
  file: string | null;
  /** True once the process has taken the sitting's first frame. */
  started: boolean;
  readings: Reading[];
  finish: { resolve: (result: WebcamSittingResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null;
};

type Session = {
  child: ChildProcessWithoutNullStreams;
  /** Unread tail of the process's output. */
  tail: string;
  pending: number;
  /** Frames this server would not queue behind a busy process. */
  skipped: number;
  outlines: LiveRegions | null;
  facePresent: boolean;
  exposureLocked: boolean;
  sitting: RunningSitting | null;
  idle?: NodeJS.Timeout;
};

const globalForWebcam = globalThis as typeof globalThis & { triagecamWebcamSessions?: Map<string, Session> };
const sessions = (globalForWebcam.triagecamWebcamSessions ??= new Map());

function binary(): string {
  const configured = env().LIVE_SITTING_BIN;
  return resolve(/*turbopackIgnore: true*/ process.cwd(), configured ?? "../../eval/video-to-sitting/.build/release/live-sitting");
}

const unavailable = () =>
  new ApiError("engine_unavailable", "The measuring engine for the webcam is not built on this server. Run pnpm webcam:build, then try again.");

function drop(deviceId: string, session: Session, reason: string): void {
  if (sessions.get(deviceId) === session) sessions.delete(deviceId);
  clearTimeout(session.idle);
  const finish = session.sitting?.finish;
  if (finish) {
    clearTimeout(finish.timer);
    finish.reject(new ApiError("engine_unavailable", reason));
  }
  if (session.sitting?.file) void rm(session.sitting.file, { force: true });
  session.sitting = null;
  session.child.stdin.destroy();
  session.child.kill();
}

/** The process finished a sitting: hand the summary to whoever asked, and keep the file in development. */
async function summarised(session: Session, message: { sittingId: string; endedAt: number; summary: Record<string, unknown>; file: boolean }): Promise<void> {
  const sitting = session.sitting;
  if (!sitting || sitting.id !== message.sittingId) return;
  session.sitting = null;
  const finish = sitting.finish;
  if (finish) clearTimeout(finish.timer);
  try {
    const summary = wireSummary(message.summary);
    finish?.resolve({ summary, endedAt: new Date(Math.round(message.endedAt * 1000)).toISOString(), readings: sitting.readings });
  } catch (error) {
    console.error("[webcam] The engine's summary could not be read:", error);
    finish?.reject(new ApiError("internal", "The sitting's summary could not be read"));
  }
  if (!sitting.file) return;
  try {
    if (message.file) await saveSittingFile(sitting.id, await readFile(sitting.file));
  } catch (error) {
    console.error("[webcam] The sitting file was not kept:", error);
  } finally {
    await rm(sitting.file, { force: true });
  }
}

function receive(deviceId: string, session: Session, line: string): void {
  let message: { type?: string } & Record<string, unknown>;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  switch (message.type) {
    case "frame": {
      session.pending = Math.max(0, session.pending - 1);
      const outlines = LiveRegions.safeParse(message.outlines);
      session.outlines = outlines.success ? outlines.data : null;
      session.facePresent = outlines.success && outlines.data.face !== null;
      session.exposureLocked = message.exposureLocked === true;
      break;
    }
    case "started":
      if (session.sitting && session.sitting.id === message.sittingId) session.sitting.started = true;
      break;
    case "reading": {
      const sitting = session.sitting;
      if (!sitting || sitting.id !== message.sittingId || sitting.readings.length >= MAX_READINGS) break;
      try {
        sitting.readings.push(wireReading(message.reading as EngineReading));
      } catch (error) {
        console.error("[webcam] A reading from the engine could not be read:", error);
      }
      break;
    }
    case "summary":
      void summarised(session, message as never);
      break;
    case "error":
      // A frame that could not be decoded was still counted as handed over.
      if (message.message === "A frame could not be decoded") session.pending = Math.max(0, session.pending - 1);
      else if (message.message === "No sitting is running" && session.sitting?.finish) {
        // Ended before the engine had taken a single frame of it: there is nothing to summarise.
        clearTimeout(session.sitting.finish.timer);
        session.sitting.finish.reject(new ApiError("conflict", "The sitting ended before the webcam sent a frame"));
        session.sitting = null;
      } else console.error(`[webcam] live-sitting for ${deviceId}: ${String(message.message)}`);
      break;
  }
}

function open(deviceId: string): Session {
  const existing = sessions.get(deviceId);
  if (existing) return existing;
  const path = binary();
  if (!existsSync(path)) throw unavailable();
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
  const session: Session = { child, tail: "", pending: 0, skipped: 0, outlines: null, facePresent: false, exposureLocked: false, sitting: null };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const lines = (session.tail + chunk).split("\n");
    session.tail = lines.pop() ?? "";
    for (const line of lines) if (line) receive(deviceId, session, line);
  });
  // Vision logs its model choice to stderr on the first frame: not ours to keep.
  child.stderr.resume();
  child.stdin.on("error", () => drop(deviceId, session, "The measuring engine stopped"));
  child.on("error", () => drop(deviceId, session, "The measuring engine could not be started"));
  child.on("exit", () => drop(deviceId, session, "The measuring engine stopped"));
  sessions.set(deviceId, session);
  return session;
}

function snapshot(session: Session, viewers: number, readingsAfter: number): PostWebcamFramesResponse {
  const sitting = session.sitting;
  return {
    viewers,
    outlines: session.outlines,
    facePresent: session.facePresent,
    exposureLocked: session.exposureLocked,
    sittingId: sitting?.started ? sitting.id : null,
    readings: sitting?.started ? sitting.readings.slice(readingsAfter, readingsAfter + 120) : [],
  };
}

/**
 * Hands frames, in capture order, to the webcam's engine process, starting it on the first.
 * Returns what the engine has made of the frames so far, with the running sitting's readings
 * after `readingsAfter`.
 */
export function feedFrames(deviceId: string, frames: WebcamFrame[], dropped: number, viewers: number, readingsAfter: number): PostWebcamFramesResponse {
  const session = open(deviceId);
  clearTimeout(session.idle);
  session.idle = setTimeout(() => drop(deviceId, session, "The webcam stopped sending frames"), WEBCAM.timeoutMs);
  for (const { jpeg, capturedAtMs } of frames) {
    if (session.pending >= MAX_PENDING) {
      // The process is behind. The frame is left out and shows in the sitting as a dropped one.
      session.skipped += 1;
      continue;
    }
    const header = Buffer.alloc(17);
    header.write("F", 0, "latin1");
    header.writeDoubleLE(capturedAtMs / 1000, 1);
    header.writeUInt32LE(Math.min(0xffffffff, dropped + session.skipped), 9);
    header.writeUInt32LE(jpeg.byteLength, 13);
    session.pending += 1;
    session.child.stdin.write(header);
    session.child.stdin.write(jpeg);
  }
  return snapshot(session, viewers, readingsAfter);
}

/** Starts the engine's sitting on the frames that follow. The sitting must be this device's own, and running. */
export async function startWebcamSitting(deviceId: string, sittingId: string): Promise<void> {
  const { sitting } = await sittingDetail(sittingId);
  if (sitting.deviceId !== deviceId) throw new ApiError("forbidden", "That sitting belongs to another camera");
  if (sitting.endedAt !== null) throw new ApiError("sitting_finished", "That sitting has ended");
  const session = sessions.get(deviceId);
  if (!session) throw new ApiError("conflict", "The webcam is not sending frames");
  if (session.sitting?.file) void rm(session.sitting.file, { force: true });
  // Sitting files are for tuning, in development only, as for a phone's.
  const file = isProduction() ? null : join(tmpdir(), `triagecam-webcam-${sittingId}.jsonl`);
  session.sitting = { id: sittingId, file, started: false, readings: [], finish: null };
  const body = Buffer.from(JSON.stringify({ sittingId, file }), "utf8");
  const header = Buffer.alloc(5);
  header.write("S", 0, "latin1");
  header.writeUInt32LE(body.byteLength, 1);
  session.child.stdin.write(Buffer.concat([header, body]));
}

/** Ends the engine's sitting and returns its summary: the body of the finish request. */
export function finishWebcamSitting(deviceId: string, sittingId: string): Promise<WebcamSittingResponse> {
  const session = sessions.get(deviceId);
  const sitting = session?.sitting;
  if (!session || !sitting || sitting.id !== sittingId) return Promise.reject(new ApiError("conflict", "That sitting is not running on the webcam"));
  if (sitting.finish) return Promise.reject(new ApiError("conflict", "That sitting is already being finished"));
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      sitting.finish = null;
      reject(new ApiError("engine_unavailable", "The measuring engine did not answer"));
    }, SUMMARY_TIMEOUT_MS);
    sitting.finish = { resolve: resolvePromise, reject, timer };
    session.child.stdin.write("E", "latin1");
  });
}

/** Gives the engine's sitting up. Nothing is kept. Safe to call when there is none. */
export function abandonWebcamSitting(deviceId: string, sittingId: string): void {
  const session = sessions.get(deviceId);
  const sitting = session?.sitting;
  if (!session || !sitting || sitting.id !== sittingId) return;
  if (sitting.finish) clearTimeout(sitting.finish.timer);
  session.sitting = null;
  session.child.stdin.write("A", "latin1");
  if (sitting.file) setTimeout(() => void rm(sitting.file as string, { force: true }), 1000);
}

/** The webcam is off: its engine process stops. */
export function closeWebcam(deviceId: string): void {
  const session = sessions.get(deviceId);
  if (session) drop(deviceId, session, "The webcam was closed");
}
