import { type TicketDetailResponse, type TicketResponse, UpdateTicketRequest } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readJson, route, ticketNumberParam } from "@/server/http";
import { ticketDetail, updateTicket } from "@/server/tickets";

type Context = RouteContext<"/api/tickets/[number]">;

export const GET = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const number = ticketNumberParam((await context.params).number);
  return Response.json((await ticketDetail(number)) satisfies TicketDetailResponse);
});

export const PATCH = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const number = ticketNumberParam((await context.params).number);
  const { faceOptIn } = await readJson(request, UpdateTicketRequest);
  return Response.json({ ticket: await updateTicket(number, faceOptIn) } satisfies TicketResponse);
});
