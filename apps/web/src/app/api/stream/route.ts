import * as z from "zod";

import { requireSession } from "@/server/auth/session";
import { subscribe } from "@/server/events";
import { readQuery, route } from "@/server/http";
import { streamResponse } from "@/server/streaming";

const StreamQuery = z.object({ ticket: z.coerce.number().int().positive().optional() });
const PING_MS = 15_000;

export const GET = route(async (request: Request) => {
  await requireSession(request);
  const { ticket } = readQuery(request, StreamQuery);
  return streamResponse(request, "text/event-stream; charset=utf-8", (write) => {
    write(": connected\n\n");
    const unsubscribe = subscribe((event) => {
      if (event.type === "reading" && ticket !== undefined && event.ticketNumber !== ticket) return;
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => write(": ping\n\n"), PING_MS);
    return () => {
      unsubscribe();
      clearInterval(ping);
    };
  });
});
