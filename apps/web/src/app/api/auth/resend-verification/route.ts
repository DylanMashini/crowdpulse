import { ResendVerificationRequest, type ResendVerificationResponse } from "@triagecam/contracts";

import { resendVerification } from "@/server/auth/accounts";
import { readJson, route } from "@/server/http";
import { clientAddress, MINUTE_MS, rateLimit } from "@/server/rate-limit";

export const POST = route(async (request: Request) => {
  rateLimit(`resend-verification:${clientAddress(request)}`, 20, 10 * MINUTE_MS);
  const { email } = await readJson(request, ResendVerificationRequest);
  // Counted per address whether or not it has an account, so the limit gives nothing away.
  rateLimit(`resend-verification:${email}`, 3, 10 * MINUTE_MS);
  return Response.json({ ok: true, ...(await resendVerification(email)) } satisfies ResendVerificationResponse);
});
