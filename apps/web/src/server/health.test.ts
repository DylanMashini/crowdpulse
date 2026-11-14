import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { databaseReachable, sharedCheck } from "./health.ts";

describe("databaseReachable", () => {
  it("answers false, and does not throw, when nothing is listening", async () => {
    assert.equal(await databaseReachable("postgres://127.0.0.1:1/nothing"), false);
  });

  it("answers false for an address that is not a database URL", async () => {
    assert.equal(await databaseReachable("not a url"), false);
  });

  it("answers true for the database in DATABASE_URL", { skip: !process.env.DATABASE_URL }, async () => {
    assert.equal(await databaseReachable(process.env.DATABASE_URL as string), true);
  });
});

describe("sharedCheck", () => {
  it("runs one check for the requests of five seconds, then a fresh one", async () => {
    let now = 0;
    let checks = 0;
    let answer = true;
    const shared = sharedCheck(async () => {
      checks += 1;
      return answer;
    }, () => now);

    assert.deepEqual(await Promise.all([shared(), shared(), shared()]), [true, true, true]);
    now = 4999;
    assert.equal(await shared(), true);
    assert.equal(checks, 1);

    answer = false;
    now = 5000;
    assert.equal(await shared(), false);
    assert.equal(checks, 2);
  });
});
