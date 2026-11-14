import { SignUpRequest, type SignUpResponse } from "@triagecam/contracts";

import { signUp } from "@/server/auth/accounts";
import { readJson, route } from "@/server/http";
import { clientAddress, MINUTE_MS, rateLimit } from "@/server/rate-limit";

export const POST = route(async (request: Request) => {
  rateLimit(`sign-up:${clientAddress(request)}`, 20, 10 * MINUTE_MS);
  const { email, password } = await readJson(request, SignUpRequest);
  return Response.json((await signUp(email, password)) satisfies SignUpResponse, { status: 201 });
});
