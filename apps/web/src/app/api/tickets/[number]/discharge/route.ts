import type { TicketResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { route, ticketNumberParam } from "@/server/http";
import { dischargeTicket } from "@/server/tickets";

export const POST = route(async (request: Request, context: RouteContext<"/api/tickets/[number]/discharge">) => {
  await requireSession(request);
  const number = ticketNumberParam((await context.params).number);
  return Response.json({ ticket: await dischargeTicket(number) } satisfies TicketResponse);
});
