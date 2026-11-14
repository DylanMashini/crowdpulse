import { VerifyEmailRequest, type VerifyEmailResponse } from "@triagecam/contracts";

import { verifyEmail } from "@/server/auth/accounts";
import { readJson, route } from "@/server/http";
import { clientAddress, MINUTE_MS, rateLimit } from "@/server/rate-limit";

export const POST = route(async (request: Request) => {
  rateLimit(`verify-email:${clientAddress(request)}`, 30, 10 * MINUTE_MS);
  const { token } = await readJson(request, VerifyEmailRequest);
  return Response.json({ user: await verifyEmail(token) } satisfies VerifyEmailResponse);
});
