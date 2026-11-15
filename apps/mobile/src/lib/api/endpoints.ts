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
  type PostLiveStateRequest,
  PostLiveStateResponse,
  PostReadingsResponse,
  type Reading,
  ResendVerificationResponse,
  SignInResponse,
  SignUpResponse,
  type SittingKind,
  SittingResponse,
  StartSittingResponse,
  PatientDetailResponse,
  PatientListResponse,
  PatientResponse,
  SettingsResponse,
  type UpdateSettingsRequest,
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

    createPatient: () =>
      client.request({ method: 'POST', path: routes.patients, body: { faceOptIn: false } }, PatientResponse),
    patient: (number: number) => client.request({ method: 'GET', path: routes.patient(number) }, PatientDetailResponse),
    setFaceOptIn: (number: number, faceOptIn: boolean) =>
      client.request({ method: 'PATCH', path: routes.patient(number), body: { faceOptIn } }, PatientResponse),

    startSitting: (sitting: { patientNumber: number; deviceId: string; kind: SittingKind; source: CaptureSource }) =>
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
    /** The sitting was given up on the phone: it ends on the server without a summary. */
    abandonSitting: (sittingId: string) =>
      client.request({ method: 'POST', path: routes.sittingAbandon(sittingId) }, SittingResponse),
    uploadSittingFile: (sittingId: string, file: Blob) =>
      client.send({
        method: 'PUT',
        path: routes.sittingFile(sittingId),
        raw: { body: file, contentType: 'application/x-ndjson' },
      }),

    /**
     * The profile photo: the face crop from the capture module, taken during the intake sitting.
     * The server keeps it only when the patient has no photo yet.
     */
    putPatientPhoto: (patientNumber: number, jpegBase64: string) =>
      client.request({ method: 'PUT', path: routes.patientPhoto(patientNumber), body: { jpegBase64 } }, PatientResponse),

    enrolFace: (patientNumber: number, jpegBase64: string) =>
      client.request({ method: 'POST', path: routes.patientFace(patientNumber), body: { jpegBase64 } }, EnrolFaceResponse),
    matchFace: (jpegBase64: string) =>
      client.request({ method: 'POST', path: routes.faceMatch, body: { jpegBase64 } }, MatchFaceResponse),

    postLiveFrame: (deviceId: string, frame: LiveFrame) =>
      client.request({ method: 'POST', path: routes.liveFrame(deviceId), body: frame }, PostLiveFrameResponse),
    /** What this phone is doing, and its outlines. The answer may carry a command from the check-in page. */
    postLiveState: (deviceId: string, report: PostLiveStateRequest) =>
      client.request({ method: 'POST', path: routes.liveState(deviceId), body: report }, PostLiveStateResponse),

    /** Every patient of one status, newest first, a page at a time. */
    patients: (status: 'waiting' | 'discharged' | 'all', cursor?: string) =>
      client.request(
        { method: 'GET', path: routes.patients, query: { status, limit: 100, cursor } },
        PatientListResponse,
      ),
    dischargePatient: (number: number) =>
      client.request({ method: 'POST', path: routes.patientDischarge(number) }, PatientResponse),

    worklist: () => client.request({ method: 'GET', path: routes.worklist }, WorklistResponse),
    openFlags: () =>
      client.request({ method: 'GET', path: routes.flags, query: { status: 'open', limit: 200 } }, FlagListResponse),
    /** The most recent flags that have closed, newest first. */
    closedFlags: (limit: number) =>
      client.request({ method: 'GET', path: routes.flags, query: { status: 'closed', limit } }, FlagListResponse),

    settings: () => client.request({ method: 'GET', path: routes.settings }, SettingsResponse),
    updateSettings: (changes: UpdateSettingsRequest) =>
      client.request({ method: 'PATCH', path: routes.settings, body: changes }, SettingsResponse),
    acknowledgeFlag: (flagId: string) =>
      client.request({ method: 'POST', path: routes.flagAcknowledge(flagId) }, FlagResponse),
  };
}

export type Api = ReturnType<typeof createApi>;
