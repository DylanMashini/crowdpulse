import type { MeResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { route } from "@/server/http";
import { toUser } from "@/server/serialize";

export const GET = route(async (request: Request) => {
  const session = await requireSession(request);
  return Response.json({
    user: toUser(session.user),
    session: { kind: session.kind, expiresAt: session.expiresAt.toISOString() },
  } satisfies MeResponse);
});
