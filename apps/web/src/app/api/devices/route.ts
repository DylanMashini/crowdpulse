import { type DeviceListResponse, type DeviceResponse, RegisterDeviceRequest } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { listDevices, registerDevice } from "@/server/devices";
import { readJson, route } from "@/server/http";

export const POST = route(async (request: Request) => {
  const session = await requireSession(request);
  const body = await readJson(request, RegisterDeviceRequest);
  return Response.json({ device: await registerDevice(session.user.id, body) } satisfies DeviceResponse);
});

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json({ devices: await listDevices() } satisfies DeviceListResponse);
});
