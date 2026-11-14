import { randomUUID } from "node:crypto";

import type { SessionKind, User } from "@triagecam/contracts";
import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { ApiError } from "../http.ts";
import { toUser } from "../serialize.ts";
import { sendVerificationEmail } from "./email.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { createSession } from "./session.ts";
import { hashToken, newToken, VERIFICATION_LIFETIME_MS } from "./tokens.ts";

/** Replaces any earlier link for the user with a new one and sends it. */
async function issueVerification(userId: string, email: string): Promise<string | undefined> {
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, userId));
    await tx.insert(schema.emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_LIFETIME_MS),
    });
  });
  return (await sendVerificationEmail(email, token)).devToken;
}

/**
 * Creates an unverified account and emails its verification link. The answer has the same
 * shape and status whether or not the address was already registered, so the route cannot
 * be used to find out who has an account: a registered, unverified address gets a new link
 * and the new password, and a verified one is left untouched.
 */
export async function signUp(email: string, password: string): Promise<{ user: User; devVerificationToken?: string }> {
  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(schema.users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: schema.users.email })
    .returning();

  if (created) {
    return { user: toUser(created), devVerificationToken: await issueVerification(created.id, email) };
  }

  // Whoever opens the newest link owns the account, so an unverified account takes the newest
  // password. The condition is part of the update: a verified account is never changed here.
  const unverified = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.users)
      .set({ passwordHash })
      .where(and(eq(schema.users.email, email), isNull(schema.users.emailVerifiedAt)))
      .returning({ id: schema.users.id });
    if (row) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.id));
    return row;
  });
  const devVerificationToken = unverified ? await issueVerification(unverified.id, email) : undefined;
  return {
    user: { id: randomUUID(), email, emailVerified: false, createdAt: new Date().toISOString() },
    devVerificationToken,
  };
}

/** Marks the email verified. The token is deleted as it is read, so it works once. */
export async function verifyEmail(token: string): Promise<User> {
  return db.transaction(async (tx) => {
    const [used] = await tx
      .delete(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, hashToken(token)))
      .returning();
    if (!used || used.expiresAt.getTime() <= Date.now()) {
      throw new ApiError("token_invalid", "This link has expired or was already used. Ask for a new one.");
    }
    const [user] = await tx
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, used.userId))
      .returning();
    if (!user) throw new ApiError("token_invalid", "This link has expired or was already used. Ask for a new one.");
    return toUser(user);
  });
}

export async function resendVerification(email: string): Promise<{ devVerificationToken?: string }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user || user.emailVerifiedAt !== null) return {};
  return { devVerificationToken: await issueVerification(user.id, email) };
}

export async function signIn(
  email: string,
  password: string,
  kind: SessionKind,
): Promise<{ user: User; token: string; expiresAt: Date }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!(await verifyPassword(password, user?.passwordHash ?? null)) || !user) {
    throw new ApiError("invalid_credentials", "The email or password is not right");
  }
  if (user.emailVerifiedAt === null) {
    throw new ApiError("email_not_verified", "Confirm your email address before signing in");
  }
  const session = await createSession(user.id, kind);
  return { user: toUser(user), ...session };
}
