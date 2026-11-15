import {
  DeviceListResponse,
  ErrorResponse,
  FlagResponse,
  MeResponse,
  ResendVerificationResponse,
  SendCameraCommandResponse,
  SettingsResponse,
  SignInResponse,
  SignUpResponse,
  SittingDetailResponse,
  Statistics,
  PatientDetailResponse,
  PatientListResponse,
  PatientResponse,
  VerifyEmailResponse,
  WorklistResponse,
  routes,
  type ErrorCode,
  type PatientRef,
  type SendCameraCommandRequest,
  type UpdatePatientRequest,
  type UpdateSettingsRequest,
} from '@triagecam/contracts';
import type { ZodType } from 'zod';

/** `network` and `bad_response` are raised by this client; every other code comes from the server. */
export type ApiErrorCode = ErrorCode | 'network' | 'bad_response';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** The sentence to show for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong on this page. Reload and try again.';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** What was refused when the session ended: a change (`write`) or only a read. */
export type SessionEnded = { write: boolean };

const sessionEndedListeners = new Set<(refused: SessionEnded) => void>();

/**
 * Calls `listener` when any request is refused with `unauthenticated`: the session has expired
 * or was ended elsewhere, and nothing on the page can succeed until staff sign in again. One
 * place (the app shell) listens and sends them to sign-in, so no screen handles it itself. The
 * listener is told whether the refused request was a change, which was therefore not made.
 */
export function onSessionEnded(listener: (refused: SessionEnded) => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

async function send(path: string, init: RequestInit): Promise<Response> {
  if (process.env.NEXT_PUBLIC_API_MOCK === '1') {
    const { mockFetch } = await import('./mock/server');
    return mockFetch(path, init);
  }
  return fetch(path, { ...init, credentials: 'same-origin' });
}

async function request<T>(schema: ZodType<T> | null, method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await send(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 'Cannot reach the server. Check that it is running, then try again.');
  }

  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(await response.json().catch(() => null));
    if (parsed.success) {
      if (parsed.data.error.code === 'unauthenticated') sessionEndedListeners.forEach((listener) => listener({ write: method !== 'GET' }));
      throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
    }
    throw new ApiError('bad_response', `The server answered with status ${response.status} and no explanation.`, response.status);
  }

  if (schema === null) return undefined as T;
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError('bad_response', 'The server sent a response this page does not understand.', response.status);
  }
  return parsed.data;
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export type PatientStatusFilter = 'waiting' | 'discharged' | 'all';

/** Every call the dashboard makes. Paths come from the contracts package, never from literals. */
export const api = {
  me: () => request(MeResponse, 'GET', routes.auth.me),
  signIn: (email: string, password: string) =>
    request(SignInResponse, 'POST', routes.auth.signIn, { email, password, client: 'web' }),
  signUp: (email: string, password: string) => request(SignUpResponse, 'POST', routes.auth.signUp, { email, password }),
  verifyEmail: (token: string) => request(VerifyEmailResponse, 'POST', routes.auth.verifyEmail, { token }),
  resendVerification: (email: string) =>
    request(ResendVerificationResponse, 'POST', routes.auth.resendVerification, { email }),
  signOut: () => request<void>(null, 'POST', routes.auth.signOut),

  devices: () => request(DeviceListResponse, 'GET', routes.devices),
  /** Asks a camera phone to open a check-in, start the sitting, end it or call it off. */
  sendCameraCommand: (deviceId: string, command: SendCameraCommandRequest) =>
    request(SendCameraCommandResponse, 'POST', routes.liveCommand(deviceId), command),
  worklist: () => request(WorklistResponse, 'GET', routes.worklist),

  patients: (status: PatientStatusFilter, cursor?: string) =>
    request(PatientListResponse, 'GET', withQuery(routes.patients, { status, cursor, limit: 50 })),
  patient: (number: number) => request(PatientDetailResponse, 'GET', routes.patient(number)),
  /** A new patient with nothing filled in yet: the check-in page names them while the camera measures. */
  createPatient: () => request(PatientResponse, 'POST', routes.patients, {}),
  /** Saves any part of the intake form. Called as staff type. */
  updatePatient: (number: number, changes: UpdatePatientRequest) =>
    request(PatientResponse, 'PATCH', routes.patient(number), changes),
  /** Takes the profile photo from the frame a camera phone is showing now. */
  capturePatientPhoto: (number: number, deviceId: string) =>
    request(PatientResponse, 'POST', routes.patientPhotoCapture(number), { deviceId }),
  deletePatientPhoto: (number: number) => request<void>(null, 'DELETE', routes.patientPhoto(number)),
  dischargePatient: (number: number) => request(PatientResponse, 'POST', routes.patientDischarge(number)),
  acknowledgeFlag: (id: string) => request(FlagResponse, 'POST', routes.flagAcknowledge(id)),

  sitting: (id: string) => request(SittingDetailResponse, 'GET', routes.sitting(id)),

  settings: () => request(SettingsResponse, 'GET', routes.settings),
  updateSettings: (changes: UpdateSettingsRequest) => request(SettingsResponse, 'PATCH', routes.settings, changes),

  statistics: (from?: string, to?: string) => request(Statistics, 'GET', withQuery(routes.statistics, { from, to })),
};

/** Address of the multipart live-view stream of a camera phone. Null under the mock, which has no camera. */
export function liveStreamUrl(deviceId: string): string | null {
  return process.env.NEXT_PUBLIC_API_MOCK === '1' ? null : routes.liveStream(deviceId);
}

/**
 * Address of a patient's profile photo, or null when there is none and the initials show.
 * The version in the query changes with every new photo, so the browser can cache each one.
 */
export function patientPhotoUrl(patient: PatientRef): string | null {
  if (!patient.photoUpdatedAt || process.env.NEXT_PUBLIC_API_MOCK === '1') return null;
  return `${routes.patientPhoto(patient.number)}?v=${encodeURIComponent(patient.photoUpdatedAt)}`;
}
