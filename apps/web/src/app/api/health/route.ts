import type { HealthResponse } from "@triagecam/contracts";

import { databaseReachableShared } from "@/server/health";

// Asked by the load balancer every few seconds. It must not read a session: that is what
// starts the background jobs (src/server/jobs.ts), and a task that is only being health
// checked, during a deploy, must not start them.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const reachable = await databaseReachableShared();
  const body: HealthResponse = { status: reachable ? "ok" : "unavailable" };
  return Response.json(body, { status: reachable ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
