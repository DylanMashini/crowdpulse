import { CreatePatientRequest, PatientListQuery, type PatientListResponse, type PatientResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { readJson, readQuery, route } from "@/server/http";
import { createPatient, listPatients } from "@/server/patients";

export const POST = route(async (request: Request) => {
  await requireSession(request);
  const body = await readJson(request, CreatePatientRequest);
  return Response.json({ patient: await createPatient(body) } satisfies PatientResponse, { status: 201 });
});

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await listPatients(readQuery(request, PatientListQuery))) satisfies PatientListResponse);
});
