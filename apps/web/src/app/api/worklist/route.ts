import type { WorklistResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { route } from "@/server/http";
import { buildWorklist } from "@/server/worklist";

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await buildWorklist()) satisfies WorklistResponse);
});
