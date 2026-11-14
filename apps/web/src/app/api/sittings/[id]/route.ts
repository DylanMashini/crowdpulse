import type { SittingDetailResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { idParam, route } from "@/server/http";
import { sittingDetail } from "@/server/sittings";

export const GET = route(async (request: Request, context: RouteContext<"/api/sittings/[id]">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  return Response.json((await sittingDetail(id)) satisfies SittingDetailResponse);
});
