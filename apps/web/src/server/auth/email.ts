import { env, isProduction } from "../env.ts";

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Sends the verification link through Resend. Without RESEND_API_KEY outside production it
 * logs the link and returns the token, so development and tests need no mailbox. A failed
 * send is logged and not thrown: the caller's response must not depend on it.
 */
export async function sendVerificationEmail(to: string, token: string): Promise<{ devToken?: string }> {
  const { APP_URL, RESEND_API_KEY, RESEND_FROM, EMAIL_FROM } = env();
  const link = `${APP_URL.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;

  if (!RESEND_API_KEY) {
    if (isProduction()) {
      console.error("[auth] RESEND_API_KEY is not set, so the verification email was not sent.");
      return {};
    }
    console.info(`[auth] Verification link for ${to}: ${link}`);
    return { devToken: token };
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM ?? EMAIL_FROM,
        to: [to],
        subject: "Confirm your email for Triage Cam",
        text: `Open this link to confirm your email address and finish setting up your Triage Cam staff account:\n\n${link}\n\nThe link works once and expires in 24 hours. If you did not ask for an account, ignore this email.`,
        html: `<p>Confirm your email address to finish setting up your Triage Cam staff account.</p><p><a href="${link}">Confirm email address</a></p><p>The link works once and expires in 24 hours. If you did not ask for an account, ignore this email.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[auth] Resend refused the verification email: HTTP ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error("[auth] The verification email could not be sent:", error);
  }
  return {};
}
