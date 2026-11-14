import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse } from "pg-connection-string";

import { databaseUrl } from "../../scripts/database-url.mjs";

describe("databaseUrl", () => {
  const parts = { DB_HOST: "db.example.internal", DB_NAME: "triagecam", DB_USER: "triagecam", DB_PASSWORD: "p@ss:w/rd #1?&%" };

  it("survives a password full of URL punctuation, and asks for a verified connection", () => {
    const url = databaseUrl(parts);
    const parsed = parse(url);
    assert.equal(parsed.password, parts.DB_PASSWORD);
    assert.equal(parsed.user, "triagecam");
    assert.equal(parsed.host, "db.example.internal");
    assert.equal(parsed.port, "5432");
    assert.equal(parsed.database, "triagecam");
    assert.equal(new URL(url).searchParams.get("sslmode"), "verify-full");
  });

  it("takes the port and the sslmode when they are given", () => {
    const url = new URL(databaseUrl({ ...parts, DB_PORT: "6543", DB_SSLMODE: "disable" }));
    assert.equal(url.port, "6543");
    assert.equal(url.searchParams.get("sslmode"), "disable");
  });

  it("names what is missing", () => {
    assert.throws(() => databaseUrl({ DB_HOST: "db" }), /DB_NAME, DB_USER, DB_PASSWORD not set/);
  });
});
