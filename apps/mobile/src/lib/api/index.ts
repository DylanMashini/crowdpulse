import { apiUrl } from '@/config';

import { createApiClient } from './client';
import { createApi } from './endpoints';

export { ApiError, errorMessage, isApiError } from './errors';

let token: string | null = null;
let unauthenticated: () => void = () => {};

/** The bearer token for every request. The session provider sets it from expo-secure-store. */
export function setAuthToken(next: string | null): void {
  token = next;
}

/** Called when the server answers that the session is gone. */
export function onUnauthenticated(handler: () => void): void {
  unauthenticated = handler;
}

/** The app's one API: every request goes to EXPO_PUBLIC_API_URL plus a path from the contracts. */
export const api = createApi(
  createApiClient({
    baseUrl: apiUrl,
    getToken: () => token,
    onUnauthenticated: () => unauthenticated(),
  }),
);
