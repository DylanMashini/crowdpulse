import { createHash, randomBytes } from "node:crypto";

import { SESSION_COOKIE, type SessionKind } from "@triagecam/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const SESSION_LIFETIME_MS: Record<SessionKind, number> = { web: 7 * DAY_MS, mobile: 30 * DAY_MS };
export const VERIFICATION_LIFETIME_MS = DAY_MS;

/** 32 random bytes, base64url. Sent to the client once and never stored. */
export const newToken = (): string => randomBytes(32).toString("base64url");

/** What the database keeps in place of a token: its SHA-256, hex. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function cookieToken(header: string | null): string | null {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/**
 * The session token a request carries. A bearer token wins over the cookie, and a bearer
 * header that is present but malformed does not fall back to the cookie.
 */
export function sessionTokenFrom(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  const token = authorization === null ? cookieToken(headers.get("cookie")) : bearerToken(authorization);
  return token !== null && TOKEN_SHAPE.test(token) ? token : null;
}

const cookieBase = (secure: boolean) => `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; ${cookieBase(secure)}; Expires=${expiresAt.toUTCString()}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${cookieBase(secure)}; Max-Age=0`;
}
