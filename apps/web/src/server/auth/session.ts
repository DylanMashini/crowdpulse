import type { SessionKind } from "@triagecam/contracts";
import { and, eq, gt, isNotNull } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { env } from "../env.ts";
import { ApiError } from "../http.ts";
import { ensureBackgroundJobs } from "../jobs.ts";
import type { UserRow } from "../serialize.ts";
import { clearedSessionCookie, hashToken, newToken, SESSION_LIFETIME_MS, sessionCookie, sessionTokenFrom } from "./tokens.ts";

export type Session = { id: string; kind: SessionKind; expiresAt: Date; user: UserRow };

const secureCookies = () => env().APP_URL.startsWith("https://");

/** The session of a verified staff member, from the bearer token or the cookie. Throws 401 otherwise. */
export async function requireSession(request: Request): Promise<Session> {
  ensureBackgroundJobs();
  const token = sessionTokenFrom(request.headers);
  if (token) {
    const [row] = await db
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(token)),
          gt(schema.sessions.expiresAt, new Date()),
          isNotNull(schema.users.emailVerifiedAt),
        ),
      )
      .limit(1);
    if (row) return { id: row.session.id, kind: row.session.kind, expiresAt: row.session.expiresAt, user: row.user };
  }
  throw new ApiError("unauthenticated", "Sign in to continue");
}

export async function createSession(userId: string, kind: SessionKind): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS[kind]);
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, kind, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

export const sessionCookieHeader = (token: string, expiresAt: Date) => sessionCookie(token, expiresAt, secureCookies());
export const clearedCookieHeader = () => clearedSessionCookie(secureCookies());
