import { MatchFaceRequest, type MatchFaceResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { matchFace } from "@/server/face/service";
import { readJson, route } from "@/server/http";

export const POST = route(async (request: Request) => {
  await requireSession(request);
  const { jpegBase64 } = await readJson(request, MatchFaceRequest);
  return Response.json((await matchFace(jpegBase64)) satisfies MatchFaceResponse);
});
