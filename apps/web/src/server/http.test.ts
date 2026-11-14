import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, errorResponse } from "./http.ts";
import { rateLimit, RateLimiter } from "./rate-limit.ts";

describe("errorResponse", () => {
  it("sends Retry-After on a 429, with the seconds the limiter gave", async () => {
    let now = 0;
    const counters = new RateLimiter(() => now);
    rateLimit("key", 1, 300_000, counters);
    now = 20_500;
    let thrown: unknown;
    try {
      rateLimit("key", 1, 300_000, counters);
    } catch (error) {
      thrown = error;
    }
    const response = errorResponse(thrown);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "280");
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "rate_limited");
    assert.match(body.error.message, /280 seconds/);
  });

  it("sends Retry-After of one second on a 429 that names no time", () => {
    const response = errorResponse(new ApiError("rate_limited", "Too fast"));
    assert.equal(response.headers.get("retry-after"), "1");
  });

  it("sends no Retry-After on other errors", () => {
    assert.equal(errorResponse(new ApiError("not_found", "No such thing")).headers.get("retry-after"), null);
    assert.equal(errorResponse(new ApiError("unauthenticated", "Sign in", undefined, 30)).headers.get("retry-after"), null);
  });
});
