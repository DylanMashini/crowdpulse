import { PatientPhotoRequest, type PatientResponse } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { ApiError, noContent, patientNumberParam, readJson, route } from "@/server/http";
import { notePhotoChanged } from "@/server/intake";
import { findPatient, patientToWire } from "@/server/patients";
import { deletePhoto, portraitFromCrop, readPhoto, storePhoto } from "@/server/photos";

type Context = RouteContext<"/api/patients/[number]/photo">;

/** The profile photo. Staff only, like everything else about a patient. */
export const GET = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const patient = await findPatient(patientNumberParam((await context.params).number));
  const jpeg = patient.photoUpdatedAt ? await readPhoto(patient.id) : null;
  if (!jpeg) throw new ApiError("not_found", `There is no photo of patient ${patient.number}`);
  // With `v` the address names one version of the photo, so the browser may keep it.
  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
    },
  });
});

/** The phone's face crop from the capture module. Replaces an earlier photo. */
export const PUT = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const patient = await findPatient(patientNumberParam((await context.params).number));
  const { jpegBase64 } = await readJson(request, PatientPhotoRequest);
  const portrait = await portraitFromCrop(Buffer.from(jpegBase64, "base64"));
  const updated = await storePhoto(patient, portrait);
  notePhotoChanged(patient.id, true);
  return Response.json({ patient: await patientToWire(updated) } satisfies PatientResponse);
});

export const DELETE = route(async (request: Request, context: Context) => {
  await requireSession(request);
  const patient = await findPatient(patientNumberParam((await context.params).number));
  await deletePhoto(patient);
  notePhotoChanged(patient.id, false);
  return noContent();
});
