import { EnrolFaceRequest, type EnrolFaceResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { deleteFace, enrolFace } from "@/server/face/service";
import { noContent, readJson, route, patientNumberParam } from "@/server/http";

type Context = RouteContext<"/api/patients/[number]/face">;

export const POST = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const number = patientNumberParam((await context.params).number);
  const { jpegBase64 } = await readJson(request, EnrolFaceRequest);
  return Response.json((await enrolFace(number, jpegBase64)) satisfies EnrolFaceResponse, { status: 201 });
});

export const DELETE = route(async (request: Request, context: Context) => {
  await requireSession(request);
  await deleteFace(patientNumberParam((await context.params).number));
  return noContent();
});
