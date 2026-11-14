import { FlagListQuery, type FlagListResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { listFlags } from "@/server/flags";
import { readQuery, route } from "@/server/http";

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await listFlags(readQuery(request, FlagListQuery))) satisfies FlagListResponse);
});
