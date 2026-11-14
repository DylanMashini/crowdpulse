import { SignInRequest, type SignInResponse } from "@triagecam/contracts";

import { signIn } from "@/server/auth/accounts";
import { sessionCookieHeader } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { clientAddress, limitSignInAccount, limitSignInAddress } from "@/server/rate-limit";

export const POST = route(async (request: Request) => {
  const address = clientAddress(request);
  limitSignInAddress(address);
  const { email, password, client } = await readJson(request, SignInRequest);
  limitSignInAccount(address, email);

  const { user, token, expiresAt } = await signIn(email, password, client);
  const body: SignInResponse = { user, expiresAt: expiresAt.toISOString(), ...(client === "mobile" ? { token } : {}) };
  return Response.json(body, {
    headers: client === "web" ? { "Set-Cookie": sessionCookieHeader(token, expiresAt) } : undefined,
  });
});
