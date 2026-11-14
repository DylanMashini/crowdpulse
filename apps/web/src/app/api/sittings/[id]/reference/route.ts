import { PostReferenceRequest, type PostReadingsResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { idParam, readJson, route } from "@/server/http";
import { postReference } from "@/server/sittings";

export const POST = route(async (request: Request, context: RouteContext<"/api/sittings/[id]/reference">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  const { readings } = await readJson(request, PostReferenceRequest);
  return Response.json({ accepted: await postReference(id, readings) } satisfies PostReadingsResponse);
});
