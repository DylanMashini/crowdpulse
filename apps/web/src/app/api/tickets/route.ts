import { CreateTicketRequest, TicketListQuery, type TicketListResponse, type TicketResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readJson, readQuery, route } from "@/server/http";
import { createTicket, listTickets } from "@/server/tickets";

export const POST = route(async (request: Request) => {
  await requireSession(request);
  const { faceOptIn } = await readJson(request, CreateTicketRequest);
  return Response.json({ ticket: await createTicket(faceOptIn) } satisfies TicketResponse, { status: 201 });
});

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await listTickets(readQuery(request, TicketListQuery))) satisfies TicketListResponse);
});
