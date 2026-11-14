import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { databaseReachable } from "./health.ts";

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
