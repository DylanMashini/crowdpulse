import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CameraState } from "@triagecam/contracts";

import { ELSEWHERE_AFTER_MS, SILENT_AFTER_MS, sittingIsStray, type Elsewhere } from "./stray.ts";

const ID = "6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c21";
const OTHER = "6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c22";
const idle: CameraState = { phase: "idle", patientNumber: null, kind: null, sittingId: null, viewfinder: null, facePresent: false, exposureLocked: false, error: null };
const running: CameraState = { ...idle, phase: "running", patientNumber: 14, kind: "check_in", sittingId: ID, viewfinder: "measuring", facePresent: true };
const T0 = 1_700_000_000_000;
const sitting = { id: ID, startedAt: T0, lastReadingAt: null };

describe("a sitting whose phone has gone", () => {
  it("is left alone while the phone is in it, however long it runs", () => {
    const elsewhere: Elsewhere = new Map();
    assert.equal(sittingIsStray(sitting, running, elsewhere, T0 + 10 * 60_000), false);
    // The first second of a sitting: the phone knows it is starting, not yet which sitting.
    assert.equal(sittingIsStray(sitting, { ...running, phase: "starting", sittingId: null }, elsewhere, T0 + 10 * 60_000), false);
    assert.equal(sittingIsStray(sitting, { ...running, phase: "stopping" }, elsewhere, T0 + 10 * 60_000), false);
  });

  it("is ended once the phone has been reporting something else for ten seconds", () => {
    const elsewhere: Elsewhere = new Map();
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 20_000), false);
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 20_000 + ELSEWHERE_AFTER_MS - 1), false);
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 20_000 + ELSEWHERE_AFTER_MS), true);
  });

  it("counts from when the phone left it, and starts again if the phone comes back to it", () => {
    const elsewhere: Elsewhere = new Map();
    assert.equal(sittingIsStray(sitting, { ...running, sittingId: OTHER }, elsewhere, T0 + 5000), false);
    assert.equal(sittingIsStray(sitting, running, elsewhere, T0 + 9000), false);
    assert.equal(sittingIsStray(sitting, { ...idle, phase: "framing", patientNumber: 15 }, elsewhere, T0 + 16_000), false);
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 16_000 + ELSEWHERE_AFTER_MS), true);
  });

  it("is ended when the phone says nothing and sends no reading for ninety seconds", () => {
    const elsewhere: Elsewhere = new Map();
    assert.equal(sittingIsStray(sitting, null, elsewhere, T0 + SILENT_AFTER_MS - 1), false);
    assert.equal(sittingIsStray(sitting, null, elsewhere, T0 + SILENT_AFTER_MS), true);
    // An older app sends no state, only readings: each one is a sign of life.
    const reading = { ...sitting, lastReadingAt: T0 + 50_000 };
    assert.equal(sittingIsStray(reading, null, elsewhere, T0 + SILENT_AFTER_MS + 10_000), false);
    assert.equal(sittingIsStray(reading, null, elsewhere, T0 + 50_000 + SILENT_AFTER_MS), true);
  });

  it("does not hold a phone's brief silence against it once it reports again", () => {
    const elsewhere: Elsewhere = new Map();
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 20_000), false);
    assert.equal(sittingIsStray(sitting, null, elsewhere, T0 + 25_000), false);
    // Back and idle: the ten seconds start now, not at the first look.
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 31_000), false);
    assert.equal(sittingIsStray(sitting, idle, elsewhere, T0 + 31_000 + ELSEWHERE_AFTER_MS), true);
  });
});
