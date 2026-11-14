import { type SettingsResponse, UpdateSettingsRequest } from "@triagecam/contracts";

import { requireSession } from "@/server/auth/session";
import { worklistChanged } from "@/server/events";
import { readJson, route } from "@/server/http";
import { readSettings, updateSettings } from "@/server/settings";
import { syncWaitingPatients } from "@/server/trend/engine";

export const GET = route(async (request: Request) => {
  await requireSession(request);
  return Response.json((await readSettings()) satisfies SettingsResponse);
});

export const PATCH = route(async (request: Request) => {
  await requireSession(request);
  const response = await updateSettings(await readJson(request, UpdateSettingsRequest));
  // New thresholds can open or close flags straight away.
  await syncWaitingPatients();
  worklistChanged();
  return Response.json(response satisfies SettingsResponse);
});
