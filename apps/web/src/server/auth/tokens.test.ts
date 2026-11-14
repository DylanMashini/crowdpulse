import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_COOKIE } from "@triagecam/contracts";

import {
  clearedSessionCookie,
  hashToken,
  newToken,
  SESSION_LIFETIME_MS,
  sessionCookie,
  sessionTokenFrom,
  VERIFICATION_LIFETIME_MS,
} from "./tokens.ts";

const headers = (values: Record<string, string>) => new Headers(values);

describe("tokens", () => {
  it("makes 32 random bytes as base64url, different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    assert.equal(tokens.size, 200);
    for (const token of tokens) {
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token, "base64url").length, 32);
    }
  });

  it("stores a token as its SHA-256 in hex, never as itself", () => {
    const token = newToken();
    const hash = hashToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashToken(token));
    assert.notEqual(hash, hashToken(newToken()));
    assert.ok(!hash.includes(token));
    // A known vector, so the stored form cannot drift from plain SHA-256.
    assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("keeps the contract's lifetimes", () => {
    assert.equal(SESSION_LIFETIME_MS.web, 7 * 24 * 60 * 60 * 1000);
    assert.equal(SESSION_LIFETIME_MS.mobile, 30 * 24 * 60 * 60 * 1000);
    assert.equal(VERIFICATION_LIFETIME_MS, 24 * 60 * 60 * 1000);
  });
});

describe("sessionTokenFrom", () => {
  const cookieToken = newToken();
  const bearer = newToken();

  it("reads the session cookie among other cookies", () => {
    assert.equal(sessionTokenFrom(headers({ cookie: `theme=dark; ${SESSION_COOKIE}=${cookieToken}; other=1` })), cookieToken);
  });

  it("reads a bearer token, whatever the case of the scheme", () => {
    assert.equal(sessionTokenFrom(headers({ authorization: `Bearer ${bearer}` })), bearer);
    assert.equal(sessionTokenFrom(headers({ authorization: `bearer ${bearer}` })), bearer);
  });

  it("uses the bearer token when a request carries both", () => {
    const both = headers({ authorization: `Bearer ${bearer}`, cookie: `${SESSION_COOKIE}=${cookieToken}` });
    assert.equal(sessionTokenFrom(both), bearer);
  });

  it("does not fall back to the cookie when the bearer header is malformed", () => {
    const both = headers({ authorization: "Basic abc", cookie: `${SESSION_COOKIE}=${cookieToken}` });
    assert.equal(sessionTokenFrom(both), null);
  });

  it("refuses anything that is not shaped like a token", () => {
    assert.equal(sessionTokenFrom(headers({})), null);
    assert.equal(sessionTokenFrom(headers({ authorization: "Bearer short" })), null);
    assert.equal(sessionTokenFrom(headers({ cookie: `${SESSION_COOKIE}=` })), null);
    assert.equal(sessionTokenFrom(headers({ cookie: `x${SESSION_COOKIE}=${cookieToken}` })), null);
    assert.equal(sessionTokenFrom(headers({ authorization: `Bearer ${bearer}' or 1=1` })), null);
  });
});

describe("session cookie", () => {
  const expiresAt = new Date("2026-11-21T15:00:00.000Z");

  it("is httpOnly, SameSite=Lax and scoped to the whole site", () => {
    const cookie = sessionCookie("TOKEN", expiresAt, false);
    assert.equal(cookie, `${SESSION_COOKIE}=TOKEN; Path=/; HttpOnly; SameSite=Lax; Expires=Sat, 21 Nov 2026 15:00:00 GMT`);
  });

  it("is Secure only when the site is served over https", () => {
    assert.ok(sessionCookie("TOKEN", expiresAt, true).includes("; Secure"));
    assert.ok(!sessionCookie("TOKEN", expiresAt, false).includes("Secure"));
  });

  it("is cleared with the same attributes and no value", () => {
    assert.equal(clearedSessionCookie(false), `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});
