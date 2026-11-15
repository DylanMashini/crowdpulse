import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Landmarks } from "./detect.ts";
import { cosine, mostProminent, pickPortrait, prominence, SAME_PERSON_COSINE } from "./pick.ts";
import { CLEARLY_BETTER } from "./quality.ts";

const face = (x: number, y: number, eyeDistance: number): Landmarks => [
  { x: x - eyeDistance / 2, y },
  { x: x + eyeDistance / 2, y },
  { x, y: y + eyeDistance * 0.6 },
  { x: x - eyeDistance * 0.4, y: y + eyeDistance },
  { x: x + eyeDistance * 0.4, y: y + eyeDistance },
];

/** A unit vector at `degrees` in the plane: two people are two directions. */
const person = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
const PATIENT = person(0);
/** The patient again, in another frame: close, not identical. */
const PATIENT_AGAIN = person(20);
const NURSE = person(85);

function candidate(name: string, score: number, embedding: number[], prominenceValue = 50) {
  const made = { name, score, prominence: prominenceValue, embedded: 0, embed: async () => embedding };
  made.embed = async () => {
    made.embedded += 1;
    return embedding;
  };
  return made;
}

describe("prominence", () => {
  it("puts a large face above a small one", () => {
    assert.ok(prominence(face(320, 200, 80), 640, 480) > prominence(face(320, 200, 40), 640, 480));
  });

  it("puts a face in the middle above the same face at the edge", () => {
    assert.ok(prominence(face(320, 220, 60), 640, 480) > prominence(face(600, 60, 60), 640, 480));
  });

  it("still prefers a face much nearer the camera when it is off to one side", () => {
    assert.ok(prominence(face(520, 200, 120), 640, 480) > prominence(face(320, 220, 40), 640, 480));
  });

  it("picks the same face whatever order the detector lists them in", () => {
    const a = { prominence: 40 };
    const b = { prominence: 70 };
    assert.equal(mostProminent([a, b]), b);
    assert.equal(mostProminent([b, a]), b);
    assert.equal(mostProminent([]), undefined);
  });
});

describe("cosine", () => {
  it("is 1 for the same direction and 0 for unrelated ones", () => {
    assert.ok(Math.abs(cosine(PATIENT, PATIENT) - 1) < 1e-9);
    assert.ok(Math.abs(cosine(person(0), person(90))) < 1e-9);
    assert.ok(cosine(PATIENT, PATIENT_AGAIN) > SAME_PERSON_COSINE && cosine(PATIENT, NURSE) < SAME_PERSON_COSINE);
  });
});

describe("pickPortrait", () => {
  it("takes the face the camera is pointed at for the first photo, not the sharpest", async () => {
    const patient = candidate("patient", 0.4, PATIENT, 60);
    const passerBy = candidate("passer-by", 0.7, NURSE, 25);
    const picked = await pickPortrait([passerBy, patient], null);
    assert.equal(picked?.candidate, patient);
    assert.deepEqual(picked?.embedding, PATIENT);
    assert.equal(passerBy.embedded, 0);
  });

  it("takes nothing from a frame with no face", async () => {
    assert.equal(await pickPortrait([], null), null);
    assert.equal(await pickPortrait([], { score: 0.4, embedding: PATIENT }), null);
  });

  it("replaces the photo with a clearly better frame of the same person", async () => {
    const better = candidate("patient", 0.7, PATIENT_AGAIN);
    const picked = await pickPortrait([better], { score: 0.4, embedding: PATIENT });
    assert.equal(picked?.candidate, better);
    assert.deepEqual(picked?.embedding, PATIENT_AGAIN);
  });

  it("never replaces the photo with someone else, however good their frame", async () => {
    const nurse = candidate("nurse", 0.95, NURSE, 90);
    assert.equal(await pickPortrait([nurse], { score: 0.4, embedding: PATIENT }), null);
    assert.equal(nurse.embedded, 1);
  });

  it("with two people in the frame, takes the patient and passes over the better-scoring stranger", async () => {
    const nurse = candidate("nurse", 0.9, NURSE, 90);
    const patient = candidate("patient", 0.6, PATIENT_AGAIN, 40);
    for (const frame of [[nurse, patient], [patient, nurse]]) {
      assert.equal((await pickPortrait(frame, { score: 0.4, embedding: PATIENT }))?.candidate, patient);
    }
  });

  it("leaves the photo alone when the patient's own frame is no better, whoever else is there", async () => {
    const nurse = candidate("nurse", 0.9, NURSE);
    const patient = candidate("patient", 0.42, PATIENT_AGAIN);
    assert.equal(await pickPortrait([nurse, patient], { score: 0.4, embedding: PATIENT }), null);
  });

  it("does not embed a face that would not replace the photo anyway", async () => {
    const same = candidate("patient", 0.4 * CLEARLY_BETTER - 0.01, PATIENT_AGAIN);
    assert.equal(await pickPortrait([same], { score: 0.4, embedding: PATIENT }), null);
    assert.equal(same.embedded, 0);
  });

  it("compares only a few faces of a crowd", async () => {
    const crowd = Array.from({ length: 8 }, (_, index) => candidate(`stranger ${index}`, 0.9 - index * 0.01, NURSE));
    assert.equal(await pickPortrait(crowd, { score: 0.4, embedding: PATIENT }), null);
    assert.equal(crowd.reduce((total, each) => total + each.embedded, 0), 3);
  });

  it("replaces the phone's own crop, which has no embedding, with the face the camera is pointed at", async () => {
    const patient = candidate("patient", 0.3, PATIENT, 60);
    const other = candidate("other", 0.8, NURSE, 20);
    const picked = await pickPortrait([other, patient], { score: 0, embedding: null });
    assert.equal(picked?.candidate, patient);
  });
});
