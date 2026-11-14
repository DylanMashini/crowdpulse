import { SendCameraCommandRequest, type SendCameraCommandResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { findDevice } from "@/server/devices";
import { ApiError, idParam, readJson, route } from "@/server/http";
import { sendCommand } from "@/server/live";
import { findWaitingPatient } from "@/server/patients";

/**
 * The check-in page's controls: open a check-in on the phone, start the sitting, end it, or
 * call it off. The phone collects the command with its next state report and its own screen
 * follows, so the two never disagree about what is running.
 */
export const POST = route(async (request: Request, context: RouteContext<"/api/live/[deviceId]/command">) => {
  await requireSession(request);
  const device = await findDevice(idParam((await context.params).deviceId, "device"));
  if (device.role !== "camera") throw new ApiError("invalid_request", "Only a camera phone takes commands");
  const body = await readJson(request, SendCameraCommandRequest);
  // A check-in is opened for someone in the waiting room: 404 or 409 here, not a phone left framing nobody.
  if (body.type === "open" && body.patientNumber !== undefined) await findWaitingPatient(body.patientNumber);
  return Response.json({ command: sendCommand(device.id, device.label, body) } satisfies SendCameraCommandResponse, { status: 202 });
});
