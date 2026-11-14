import { type Statistics, StatisticsQuery } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readQuery, route } from "@/server/http";
import { statistics } from "@/server/statistics";

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await statistics(readQuery(request, StatisticsQuery))) satisfies Statistics);
});
