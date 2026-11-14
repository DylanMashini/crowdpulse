import * as z from 'zod';

import { Id, Timestamp } from './common.ts';

export const SESSION_COOKIE = 'tc_session';

export const Email = z.email().max(254).transform((value) => value.trim().toLowerCase());
/** bcrypt reads at most 72 bytes, so longer passwords are refused instead of silently cut. */
export const Password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .refine((value) => new TextEncoder().encode(value).length <= 72, 'Use at most 72 bytes');

export const User = z.object({
  id: Id,
  email: z.string(),
  emailVerified: z.boolean(),
  createdAt: Timestamp,
});
export type User = z.infer<typeof User>;

export const SignUpRequest = z.object({ email: Email, password: Password });
export type SignUpRequest = z.infer<typeof SignUpRequest>;
export const SignUpResponse = z.object({
  user: User,
  /** Present only when the server has no RESEND_API_KEY and is not in production. */
  devVerificationToken: z.string().optional(),
});
export type SignUpResponse = z.infer<typeof SignUpResponse>;

export const VerifyEmailRequest = z.object({ token: z.string().min(1) });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>;
export const VerifyEmailResponse = z.object({ user: User });
export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponse>;

export const ResendVerificationRequest = z.object({ email: Email });
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequest>;
export const ResendVerificationResponse = z.object({
  ok: z.literal(true),
  devVerificationToken: z.string().optional(),
});
export type ResendVerificationResponse = z.infer<typeof ResendVerificationResponse>;

export const SessionKind = z.enum(['web', 'mobile']);
export type SessionKind = z.infer<typeof SessionKind>;

export const SignInRequest = z.object({
  email: Email,
  password: z.string().min(1),
  /** web sets the httpOnly cookie; mobile returns a bearer token in the body. */
  client: SessionKind,
});
export type SignInRequest = z.infer<typeof SignInRequest>;
export const SignInResponse = z.object({
  user: User,
  /** Bearer token. Present only for client mobile. */
  token: z.string().optional(),
  expiresAt: Timestamp,
});
export type SignInResponse = z.infer<typeof SignInResponse>;

export const MeResponse = z.object({ user: User, session: z.object({ kind: SessionKind, expiresAt: Timestamp }) });
export type MeResponse = z.infer<typeof MeResponse>;
