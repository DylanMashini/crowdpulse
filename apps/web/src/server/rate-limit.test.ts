import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "./http.ts";
import {
  addressBucket,
  forwardedClient,
  limitSignInAccount,
  limitSignInAddress,
  RateLimiter,
  SIGN_IN_LIMITS,
  SIGN_IN_WINDOW_MS,
} from "./rate-limit.ts";

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

describe("addressBucket", () => {
  it("leaves an IPv4 address, and anything that is not an address, as it is", () => {
    assert.equal(addressBucket("198.51.100.9"), "198.51.100.9");
    assert.equal(addressBucket("direct"), "direct");
    assert.equal(addressBucket("not:an:address"), "not:an:address");
  });

  it("counts every IPv6 address in one /64 as the same caller", () => {
    const bucket = "2001:db8:12:3400::/64";
    assert.equal(addressBucket("2001:db8:12:3400::1"), bucket);
    assert.equal(addressBucket("2001:0db8:0012:3400:ffff:ffff:ffff:ffff"), bucket);
    assert.equal(addressBucket("2001:DB8:12:3400:a:b:c:d"), bucket);
    assert.equal(addressBucket("[2001:db8:12:3400::9]"), bucket);
    assert.equal(addressBucket("2001:db8:12:3400::9%en0"), bucket);
  });

  it("keeps neighbouring /64s apart", () => {
    assert.notEqual(addressBucket("2001:db8:12:3400::1"), addressBucket("2001:db8:12:3401::1"));
    assert.equal(addressBucket("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(addressBucket("::1"), "0:0:0:0::/64");
  });

  it("counts an IPv4 address written as IPv6 as the IPv4 address", () => {
    assert.equal(addressBucket("::ffff:198.51.100.9"), "198.51.100.9");
    assert.equal(addressBucket("::ffff:c633:6409"), "198.51.100.9");
  });
});

describe("sign-in limits", () => {
  const attempt = (counters: RateLimiter, address: string, email: string): boolean => {
    try {
      limitSignInAddress(address, counters);
      limitSignInAccount(address, email, counters);
      return true;
    } catch (error) {
      assert.ok(error instanceof ApiError && error.code === "rate_limited");
      return false;
    }
  };

  it("stops one address guessing at one account after 10 attempts, and leaves its other accounts alone", () => {
    const counters = new RateLimiter(() => 0);
    for (let n = 0; n < SIGN_IN_LIMITS.perAddressAndAccount; n += 1) {
      assert.equal(attempt(counters, "198.51.100.9", "nurse@example.test"), true);
    }
    assert.equal(attempt(counters, "198.51.100.9", "nurse@example.test"), false);
    assert.equal(attempt(counters, "198.51.100.9", "other@example.test"), true);
  });

  it("lets many people behind one IPv4 address sign in to their own accounts", () => {
    const counters = new RateLimiter(() => 0);
    for (let person = 0; person < 40; person += 1) {
      assert.equal(attempt(counters, "203.0.113.7", `staff${person}@example.test`), true, `person ${person}`);
    }
    // And one of them mistyping a few times does not stop the rest.
    for (let n = 0; n < 5; n += 1) attempt(counters, "203.0.113.7", "staff0@example.test");
    assert.equal(attempt(counters, "203.0.113.7", "staff1@example.test"), true);
  });

  it("stops guessing at one account from many addresses, where no single address reaches its own limit", () => {
    const counters = new RateLimiter(() => 0);
    let allowed = 0;
    for (let n = 0; n < 200; n += 1) {
      if (attempt(counters, `198.51.100.${n}`, "nurse@example.test")) allowed += 1;
    }
    assert.equal(allowed, SIGN_IN_LIMITS.perAccount);
    // Other accounts are not affected.
    assert.equal(attempt(counters, "198.51.100.1", "other@example.test"), true);
  });

  it("gives a host that walks through its IPv6 /64 one allowance, not one per address", () => {
    const counters = new RateLimiter(() => 0);
    let allowed = 0;
    for (let n = 0; n < 50; n += 1) {
      const address = addressBucket(`2001:db8:12:3400::${n.toString(16)}`);
      if (attempt(counters, address, "nurse@example.test")) allowed += 1;
    }
    assert.equal(allowed, SIGN_IN_LIMITS.perAddressAndAccount);
  });

  it("one caller hammering an account from one address does not lock its owner out elsewhere", () => {
    const counters = new RateLimiter(() => 0);
    for (let n = 0; n < 500; n += 1) attempt(counters, "198.51.100.9", "nurse@example.test");
    assert.equal(attempt(counters, "203.0.113.7", "nurse@example.test"), true);
  });

  it("starts again when the window has passed", () => {
    let now = 0;
    const counters = new RateLimiter(() => now);
    for (let n = 0; n < 200; n += 1) attempt(counters, `198.51.100.${n}`, "nurse@example.test");
    assert.equal(attempt(counters, "203.0.113.7", "nurse@example.test"), false);
    now = SIGN_IN_WINDOW_MS;
    assert.equal(attempt(counters, "203.0.113.7", "nurse@example.test"), true);
  });
});
