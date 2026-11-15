/** Every API path, relative to the API base URL. Build URLs with these, not by hand. */
export const routes = {
  /** Public. For the load balancer: 200 when the server can reach its database, 503 when it cannot. */
  health: '/api/health',
  auth: {
    signUp: '/api/auth/sign-up',
    verifyEmail: '/api/auth/verify-email',
    resendVerification: '/api/auth/resend-verification',
    signIn: '/api/auth/sign-in',
    signOut: '/api/auth/sign-out',
    me: '/api/auth/me',
  },
  devices: '/api/devices',
  patients: '/api/patients',
  patient: (number: number) => `/api/patients/${number}`,
  patientDischarge: (number: number) => `/api/patients/${number}/discharge`,
  patientFace: (number: number) => `/api/patients/${number}/face`,
  /** GET serves the JPEG, PUT stores the phone's face crop, DELETE removes it. Append `?v=<photoUpdatedAt>` when showing it. */
  patientPhoto: (number: number) => `/api/patients/${number}/photo`,
  /** POST: take the photo from a camera phone's current live frame. */
  patientPhotoCapture: (number: number) => `/api/patients/${number}/photo/capture`,
  sittings: '/api/sittings',
  sitting: (id: string) => `/api/sittings/${id}`,
  sittingReadings: (id: string) => `/api/sittings/${id}/readings`,
  sittingFinish: (id: string) => `/api/sittings/${id}/finish`,
  /** POST: the phone gave the sitting up. It ends without a summary. */
  sittingAbandon: (id: string) => `/api/sittings/${id}/abandon`,
  sittingFile: (id: string) => `/api/sittings/${id}/file`,
  worklist: '/api/worklist',
  flags: '/api/flags',
  flagAcknowledge: (id: string) => `/api/flags/${id}/acknowledge`,
  settings: '/api/settings',
  statistics: '/api/statistics',
  faceMatch: '/api/face/match',
  liveFrame: (deviceId: string) => `/api/live/${deviceId}/frame`,
  liveStream: (deviceId: string) => `/api/live/${deviceId}/stream`,
  /** POST, from the phone: its state and outlines. The answer carries a waiting command. */
  liveState: (deviceId: string) => `/api/live/${deviceId}/state`,
  /** POST, from the dashboard: a command for the phone. */
  liveCommand: (deviceId: string) => `/api/live/${deviceId}/command`,
  /** POST, from the check-in page's own webcam: the frames taken since the last request. The answer carries outlines and readings. */
  webcamFrames: (deviceId: string) => `/api/webcam/${deviceId}/frames`,
  /** POST, from the same page: start, finish or abandon the engine's sitting on those frames. */
  webcamSitting: (deviceId: string) => `/api/webcam/${deviceId}/sitting`,
  /** DELETE: the webcam is off. The server's engine for it stops. */
  webcam: (deviceId: string) => `/api/webcam/${deviceId}`,
  stream: '/api/stream',
} as const;
