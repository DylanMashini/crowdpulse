import { clearedCookieHeader, deleteSession, requireSession } from "@/server/auth/session";
import { route } from "@/server/http";

export const POST = route(async (request: Request) => {
  const session = await requireSession(request);
  await deleteSession(session.id);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookieHeader() } });
});
