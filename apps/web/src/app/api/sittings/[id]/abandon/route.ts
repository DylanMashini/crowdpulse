import type { SittingResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { idParam, route } from "@/server/http";
import { abandonSitting } from "@/server/sittings";

export const POST = route(async (request: Request, context: RouteContext<"/api/sittings/[id]/abandon">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  return Response.json({ sitting: await abandonSitting(id) } satisfies SittingResponse);
});
