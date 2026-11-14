import {
  DeviceListResponse,
  ErrorResponse,
  FlagResponse,
  MeResponse,
  PostReadingsResponse,
  ResendVerificationResponse,
  SettingsResponse,
  SignInResponse,
  SignUpResponse,
  SittingDetailResponse,
  Statistics,
  TicketDetailResponse,
  TicketListResponse,
  TicketResponse,
  VerifyEmailResponse,
  WorklistResponse,
  routes,
  type ErrorCode,
  type ReferenceReading,
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

type Method = 'GET' | 'POST' | 'PATCH';

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
    if (parsed.success) throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
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

export type TicketStatusFilter = 'waiting' | 'discharged' | 'all';

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
  worklist: () => request(WorklistResponse, 'GET', routes.worklist),

  tickets: (status: TicketStatusFilter, cursor?: string) =>
    request(TicketListResponse, 'GET', withQuery(routes.tickets, { status, cursor, limit: 50 })),
  ticket: (number: number) => request(TicketDetailResponse, 'GET', routes.ticket(number)),
  dischargeTicket: (number: number) => request(TicketResponse, 'POST', routes.ticketDischarge(number)),
  acknowledgeFlag: (id: string) => request(FlagResponse, 'POST', routes.flagAcknowledge(id)),

  sitting: (id: string) => request(SittingDetailResponse, 'GET', routes.sitting(id)),
  postReference: (sittingId: string, readings: ReferenceReading[]) =>
    request(PostReadingsResponse, 'POST', routes.sittingReference(sittingId), { readings }),

  settings: () => request(SettingsResponse, 'GET', routes.settings),
  updateSettings: (changes: UpdateSettingsRequest) => request(SettingsResponse, 'PATCH', routes.settings, changes),

  statistics: (from?: string, to?: string) => request(Statistics, 'GET', withQuery(routes.statistics, { from, to })),
};

/** Address of the multipart preview stream, for an img element. */
export function liveStreamUrl(deviceId: string): string {
  if (process.env.NEXT_PUBLIC_API_MOCK === '1') {
    const pattern =
      "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360'><rect width='480' height='360' fill='#0a0f0e'/>" +
      "<path d='M0 120h480M0 240h480M160 0v360M320 0v360' stroke='#2a3531'/>" +
      "<text x='240' y='186' fill='#a3b1ac' font-family='sans-serif' font-size='18' text-anchor='middle'>Mock test pattern</text></svg>";
    return `data:image/svg+xml;utf8,${encodeURIComponent(pattern)}`;
  }
  return routes.liveStream(deviceId);
}
