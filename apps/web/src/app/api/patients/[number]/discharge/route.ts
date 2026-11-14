import type { PatientResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { route, patientNumberParam } from "@/server/http";
import { dischargePatient } from "@/server/patients";

export const POST = route(async (request: Request, context: RouteContext<"/api/patients/[number]/discharge">) => {
  await requireSession(request);
  const number = patientNumberParam((await context.params).number);
  return Response.json({ patient: await dischargePatient(number) } satisfies PatientResponse);
});
