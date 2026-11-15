import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIVE_VIEW, type CameraState, type LiveRegions, type StreamEvent } from "@triagecam/contracts";

import { subscribe } from "./events.ts";
import { ApiError } from "./http.ts";
import { cameraState, postFrame, reportState, sendCommand, watch, type RelayedFrame } from "./live.ts";

const idle: CameraState = { phase: "idle", patientNumber: null, kind: null, sittingId: null, viewfinder: null, facePresent: false, exposureLocked: false, error: null };
const framing: CameraState = { ...idle, phase: "framing", patientNumber: 14, kind: "check_in", viewfinder: "locking", facePresent: true };
const running: CameraState = { ...framing, phase: "running", viewfinder: "measuring", exposureLocked: true };

const square = [
  { x: 0.412345678, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.3 },
  { x: 0.4, y: 0.3 },
];
const regions: LiveRegions = { aspectRatio: 4 / 3, face: { x: 0.35, y: 0.15, width: 0.3, height: 0.5 }, forehead: square, leftCheek: square, rightCheek: square, chest: null };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

let next = 0;
const device = () => `device-${++next}`;

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error;
  }
  throw new Error("The call was not refused");
}

describe("the phone's state on the live-view channel", () => {
  it("is published when it changes, not every time it is reported, and lapses when the phone goes quiet", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    const seen: StreamEvent[] = [];
    const unsubscribe = subscribe((event) => {
      if (event.type === "camera_state" && event.deviceId === id) seen.push(event);
    });

    assert.equal(cameraState(id), null);
    reportState(id, idle, null);
    reportState(id, idle, null);
    reportState(id, framing, regions);
    assert.deepEqual(seen.map((event) => event.type === "camera_state" && event.state?.phase), ["idle", "framing"]);
    assert.equal(cameraState(id)?.patientNumber, 14);

    t.mock.timers.tick(LIVE_VIEW.stateTimeoutMs - 1);
    assert.equal(cameraState(id)?.phase, "framing");
    t.mock.timers.tick(1);
    assert.equal(cameraState(id), null);
    assert.deepEqual(seen.at(-1), { type: "camera_state", deviceId: id, state: null });
    unsubscribe();
  });

  it("puts the outlines on the frames that follow them, rounded, and leaves them off once they are old", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const id = device();
    const frames: RelayedFrame[] = [];
    const unwatch = watch(id, (frame) => frames.push(frame));

    postFrame(id, jpeg);
    assert.equal(frames.at(-1)?.regions, null);

    assert.equal(reportState(id, framing, regions).viewers, 1);
    postFrame(id, jpeg);
    const sent = JSON.parse(frames.at(-1)?.regions ?? "null") as LiveRegions;
    assert.equal(sent.forehead?.[0]?.x, 0.4123);
    assert.equal(sent.chest, null);

    t.mock.timers.tick(LIVE_VIEW.regionsMaxAgeMs + 1);
    postFrame(id, jpeg);
    assert.equal(frames.at(-1)?.regions, null);

    // No face, no outlines.
    reportState(id, framing, { ...regions, face: null, forehead: null, leftCheek: null, rightCheek: null });
    postFrame(id, jpeg);
    assert.equal(frames.at(-1)?.regions, null);
    unwatch();
  });
});

describe("commands from the check-in page", () => {
  it("are refused for a phone that is not reporting", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    assert.equal(refusal(() => sendCommand(device(), "Front desk phone", { type: "start" })).code, "camera_offline");
  });

  it("are handed to the phone once, with its next report", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    reportState(id, idle, null);
    const command = sendCommand(id, "Front desk phone", { type: "open", patientNumber: 14, kind: "check_in" });
    assert.deepEqual({ ...command, id: null }, { id: null, type: "open", patientNumber: 14, kind: "check_in", enrolFace: false });
    assert.deepEqual(reportState(id, idle, null).command, command);
    assert.equal(reportState(id, idle, null).command, null);
  });

  it("are one command when the button is pressed twice before the phone collects it", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    reportState(id, framing, null);
    const first = sendCommand(id, "Front desk phone", { type: "start", enrolFace: true });
    const second = sendCommand(id, "Front desk phone", { type: "start", enrolFace: true });
    assert.equal(second.id, first.id);
    assert.equal(first.enrolFace, true);
    assert.equal(reportState(id, framing, null).command?.id, first.id);
    assert.equal(reportState(id, framing, null).command, null);
  });

  it("are refused when the phone is in no state to carry them out", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    reportState(id, idle, null);
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "start" })).code, "camera_busy");
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "stop" })).code, "camera_busy");
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "cancel" })).code, "camera_busy");

    reportState(id, running, null);
    assert.match(refusal(() => sendCommand(id, "Front desk phone", { type: "start" })).message, /already running/);
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "open", patientNumber: 15, kind: "recheck" })).code, "camera_busy");
    assert.equal(sendCommand(id, "Front desk phone", { type: "stop" }).type, "stop");
    // The later command replaces the one the phone has not collected.
    assert.equal(sendCommand(id, "Front desk phone", { type: "cancel" }).type, "cancel");
    assert.equal(reportState(id, running, null).command?.type, "cancel");
  });

  it("only act on the patient the dashboard that sent them is looking at", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    reportState(id, framing, null);
    // Another dashboard opened patient 15 here a moment ago; this one still shows 14's buttons.
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "start", patientNumber: 15 })).code, "camera_busy");
    assert.equal(refusal(() => sendCommand(id, "Front desk phone", { type: "cancel", patientNumber: 15 })).code, "camera_busy");
    assert.match(refusal(() => sendCommand(id, "Front desk phone", { type: "open", patientNumber: 15, kind: "check_in" })).message, /another patient/);
    assert.equal(sendCommand(id, "Front desk phone", { type: "start", patientNumber: 14 }).type, "start");
    // A command that names nobody is taken as before.
    assert.equal(sendCommand(id, "Front desk phone", { type: "cancel" }).type, "cancel");
  });

  it("are dropped when the phone does not collect them in time", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const id = device();
    reportState(id, framing, null);
    sendCommand(id, "Front desk phone", { type: "start" });
    t.mock.timers.tick(LIVE_VIEW.commandTimeoutMs);
    // The state lapsed too (4 s), so the phone starts from nothing when it comes back.
    assert.equal(reportState(id, framing, null).command, null);
  });
});
