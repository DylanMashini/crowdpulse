import type { FlagResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { acknowledgeFlag } from "@/server/flags";
import { idParam, route } from "@/server/http";

export const POST = route(async (request: Request, context: RouteContext<"/api/flags/[id]/acknowledge">) => {
  const session = await requireSession(request);
  const id = idParam((await context.params).id, "flag");
  return Response.json({ flag: await acknowledgeFlag(id, session.user.id) } satisfies FlagResponse);
});
