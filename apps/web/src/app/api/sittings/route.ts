import { StartSittingRequest, type StartSittingResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { startSitting } from "@/server/sittings";

export const POST = route(async (request: Request) => {
  await requireSession(request);
  const body = await readJson(request, StartSittingRequest);
  return Response.json((await startSitting(body)) satisfies StartSittingResponse, { status: 201 });
});
