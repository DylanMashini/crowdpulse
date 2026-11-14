import { FinishSittingRequest, type SittingResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { idParam, readJson, route } from "@/server/http";
import { finishSitting } from "@/server/sittings";

export const POST = route(async (request: Request, context: RouteContext<"/api/sittings/[id]/finish">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  const body = await readJson(request, FinishSittingRequest);
  return Response.json({ sitting: await finishSitting(id, body) } satisfies SittingResponse);
});
