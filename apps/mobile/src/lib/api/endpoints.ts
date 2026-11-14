import {
  type CaptureSource,
  DeviceResponse,
  type DeviceRole,
  EnrolFaceResponse,
  type FinishSittingRequest,
  FlagListResponse,
  FlagResponse,
  type LiveFrame,
  MatchFaceResponse,
  MeResponse,
  PostLiveFrameResponse,
  PostReadingsResponse,
  type Reading,
  ResendVerificationResponse,
  SignInResponse,
  SignUpResponse,
  type SittingKind,
  SittingResponse,
  StartSittingResponse,
  TicketDetailResponse,
  TicketResponse,
  VerifyEmailResponse,
  WorklistResponse,
  routes,
} from '@triagecam/contracts';

import type { ApiClient } from './client.ts';

/** One function per route the mobile app uses. Paths come from the contracts package. */
export function createApi(client: ApiClient) {
  return {
    baseUrl: client.baseUrl,

    signUp: (email: string, password: string) =>
      client.request({ method: 'POST', path: routes.auth.signUp, body: { email, password } }, SignUpResponse),
    signIn: (email: string, password: string) =>
      client.request(
        { method: 'POST', path: routes.auth.signIn, body: { email, password, client: 'mobile' } },
        SignInResponse,
      ),
    resendVerification: (email: string) =>
      client.request(
        { method: 'POST', path: routes.auth.resendVerification, body: { email } },
        ResendVerificationResponse,
      ),
    verifyEmail: (token: string) =>
      client.request({ method: 'POST', path: routes.auth.verifyEmail, body: { token } }, VerifyEmailResponse),
    signOut: () => client.send({ method: 'POST', path: routes.auth.signOut }),
    me: () => client.request({ method: 'GET', path: routes.auth.me }, MeResponse),

    registerDevice: (device: { id?: string; role: DeviceRole; label: string; expoPushToken?: string | null }) =>
      client.request({ method: 'POST', path: routes.devices, body: device }, DeviceResponse),

    createTicket: () =>
      client.request({ method: 'POST', path: routes.tickets, body: { faceOptIn: false } }, TicketResponse),
    ticket: (number: number) => client.request({ method: 'GET', path: routes.ticket(number) }, TicketDetailResponse),
    setFaceOptIn: (number: number, faceOptIn: boolean) =>
      client.request({ method: 'PATCH', path: routes.ticket(number), body: { faceOptIn } }, TicketResponse),

    startSitting: (sitting: { ticketNumber: number; deviceId: string; kind: SittingKind; source: CaptureSource }) =>
      client.request(
        { method: 'POST', path: routes.sittings, body: { ...sitting, clientTime: new Date().toISOString() } },
        StartSittingResponse,
      ),
    postReadings: (sittingId: string, readings: Reading[]) =>
      client.request(
        { method: 'POST', path: routes.sittingReadings(sittingId), body: { readings } },
        PostReadingsResponse,
      ),
    finishSitting: (sittingId: string, request: FinishSittingRequest) =>
      client.request({ method: 'POST', path: routes.sittingFinish(sittingId), body: request }, SittingResponse),
    uploadSittingFile: (sittingId: string, file: Blob) =>
      client.send({
        method: 'PUT',
        path: routes.sittingFile(sittingId),
        raw: { body: file, contentType: 'application/x-ndjson' },
      }),

    enrolFace: (ticketNumber: number, jpegBase64: string) =>
      client.request({ method: 'POST', path: routes.ticketFace(ticketNumber), body: { jpegBase64 } }, EnrolFaceResponse),
    matchFace: (jpegBase64: string) =>
      client.request({ method: 'POST', path: routes.faceMatch, body: { jpegBase64 } }, MatchFaceResponse),

    postLiveFrame: (deviceId: string, frame: LiveFrame) =>
      client.request({ method: 'POST', path: routes.liveFrame(deviceId), body: frame }, PostLiveFrameResponse),

    worklist: () => client.request({ method: 'GET', path: routes.worklist }, WorklistResponse),
    openFlags: () =>
      client.request({ method: 'GET', path: routes.flags, query: { status: 'open', limit: 200 } }, FlagListResponse),
    acknowledgeFlag: (flagId: string) =>
      client.request({ method: 'POST', path: routes.flagAcknowledge(flagId) }, FlagResponse),
  };
}

export type Api = ReturnType<typeof createApi>;
