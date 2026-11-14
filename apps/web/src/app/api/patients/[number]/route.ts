import { type PatientDetailResponse, type PatientResponse, UpdatePatientRequest } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readJson, route, patientNumberParam } from "@/server/http";
import { patientDetail, updatePatient } from "@/server/patients";

type Context = RouteContext<"/api/patients/[number]">;

export const GET = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const number = patientNumberParam((await context.params).number);
  return Response.json((await patientDetail(number)) satisfies PatientDetailResponse);
});

export const PATCH = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const number = patientNumberParam((await context.params).number);
  const body = await readJson(request, UpdatePatientRequest);
  return Response.json({ patient: await updatePatient(number, body) } satisfies PatientResponse);
});
