import { SignInRequest, type SignInResponse } from "@triagecam/contracts";

import { signIn } from "@/server/auth/accounts";
import { sessionCookieHeader } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientAddress, MINUTE_MS, rateLimit } from "@/server/rate-limit";

export const POST = route(async (request: Request) => {
  const address = clientAddress(request);
  rateLimit(`sign-in:${address}`, 60, 5 * MINUTE_MS);
  const { email, password, client } = await readJson(request, SignInRequest);
  rateLimit(`sign-in:${address}:${email}`, 10, 5 * MINUTE_MS);

  const { user, token, expiresAt } = await signIn(email, password, client);
  const body: SignInResponse = { user, expiresAt: expiresAt.toISOString(), ...(client === "mobile" ? { token } : {}) };
  return Response.json(body, {
    headers: client === "web" ? { "Set-Cookie": sessionCookieHeader(token, expiresAt) } : undefined,
  });
});
