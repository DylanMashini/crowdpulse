import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientAddress, RateLimiter } from "./rate-limit.ts";

describe("RateLimiter", () => {
  it("allows up to the limit inside a window, then says how long to wait", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    assert.equal(limiter.hit("a", 3, 60_000), 0);
    assert.equal(limiter.hit("a", 3, 60_000), 0);
    assert.equal(limiter.hit("a", 3, 60_000), 0);
    now = 20_000;
    assert.equal(limiter.hit("a", 3, 60_000), 40);
  });

  it("starts again when the window has passed, and keeps keys apart", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    assert.equal(limiter.hit("a", 1, 60_000), 0);
    assert.ok(limiter.hit("a", 1, 60_000) > 0);
    assert.equal(limiter.hit("b", 1, 60_000), 0);
    now = 60_000;
    assert.equal(limiter.hit("a", 1, 60_000), 0);
  });
});

describe("clientAddress", () => {
  it("takes the first forwarded address, as the tunnel reports it", () => {
    const request = new Request("http://localhost/api", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    assert.equal(clientAddress(request), "203.0.113.7");
    assert.equal(clientAddress(new Request("http://localhost/api")), "direct");
  });
});
