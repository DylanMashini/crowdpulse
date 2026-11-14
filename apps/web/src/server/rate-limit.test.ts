import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forwardedClient, RateLimiter } from "./rate-limit.ts";

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

describe("forwardedClient", () => {
  it("takes the first forwarded address in development, as the tunnel reports it", () => {
    assert.equal(forwardedClient("203.0.113.7, 10.0.0.1", undefined), "203.0.113.7");
    assert.equal(forwardedClient(null, undefined), "direct");
  });

  it("counts back from the right past the trusted proxies, so a forged entry is ignored", () => {
    // Caller 198.51.100.9 sends a forged entry; Cloudflare appends the caller, the load
    // balancer appends Cloudflare's edge.
    const throughBoth = "1.2.3.4, 198.51.100.9, 172.70.1.1";
    assert.equal(forwardedClient(throughBoth, 2), "198.51.100.9");
    assert.equal(forwardedClient("198.51.100.9, 172.70.1.1", 2), "198.51.100.9");
    // Behind the load balancer alone.
    assert.equal(forwardedClient("1.2.3.4, 198.51.100.9", 1), "198.51.100.9");
    assert.equal(forwardedClient("2001:db8::1 , 172.70.1.1", 2), "2001:db8::1");
  });

  it("falls back to the first entry when a proxy was skipped, and to one bucket with no header", () => {
    assert.equal(forwardedClient("198.51.100.9", 2), "198.51.100.9");
    assert.equal(forwardedClient(null, 2), "direct");
    assert.equal(forwardedClient(" , ", 2), "direct");
  });

  it("gives two callers behind the same proxies two buckets", () => {
    const first = forwardedClient("198.51.100.9, 172.70.1.1", 2);
    const second = forwardedClient("198.51.100.10, 172.70.1.1", 2);
    assert.notEqual(first, second);
  });
});
