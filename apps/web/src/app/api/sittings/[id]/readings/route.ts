import { PostReadingsRequest, type PostReadingsResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { idParam, readJson, route } from "@/server/http";
import { postReadings } from "@/server/sittings";

export const POST = route(async (request: Request, context: RouteContext<"/api/sittings/[id]/readings">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  const { readings } = await readJson(request, PostReadingsRequest);
  return Response.json({ accepted: await postReadings(id, readings) } satisfies PostReadingsResponse);
});
