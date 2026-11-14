import { CapturePatientPhotoRequest, type PatientResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { findDevice } from "@/server/devices";
import { ApiError, patientNumberParam, readJson, route } from "@/server/http";
import { notePhotoChanged } from "@/server/intake";
import { currentFrame } from "@/server/live";
import { findPatient, patientToWire } from "@/server/patients";
import { portraitFromFrame, storePhoto } from "@/server/photos";

/** "Retake photo" on the check-in page: the portrait is cut from the frame on screen right now. */
export const POST = route(async (request: Request, context: RouteContext<"/api/patients/[number]/photo/capture">) => {
  await requireSession(request);
  const patient = await findPatient(patientNumberParam((await context.params).number));
  const { deviceId } = await readJson(request, CapturePatientPhotoRequest);
  const device = await findDevice(deviceId);
  const frame = currentFrame(device.id);
  if (!frame) throw new ApiError("conflict", `${device.label} is not sending a live picture right now`);
  const portrait = await portraitFromFrame(frame.jpeg);
  if (!portrait) {
    throw new ApiError("no_face_detected", "No face was found in the picture. Ask the patient to face the camera, then try again.");
  }
  const updated = await storePhoto(patient, portrait);
  notePhotoChanged(patient.id, true);
  return Response.json({ patient: await patientToWire(updated) } satisfies PatientResponse);
});
