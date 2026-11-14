import { requireSession } from "@/server/auth/session";
import { ApiError, idParam, noContent, route } from "@/server/http";
import { saveSittingFile, SITTING_FILE_MAX_BYTES } from "@/server/sittings";

export const PUT = route(async (request: Request, context: RouteContext<"/api/sittings/[id]/file">) => {
  await requireSession(request);
  const id = idParam((await context.params).id, "sitting");
  if (Number(request.headers.get("content-length") ?? 0) > SITTING_FILE_MAX_BYTES) {
    throw new ApiError("payload_too_large", "A sitting file is at most 5 MB");
  }
  await saveSittingFile(id, Buffer.from(await request.arrayBuffer()));
  return noContent();
});
