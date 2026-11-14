# Triage Cam contracts

The fixed interfaces between the capture module, the signal engine, the mobile screens, the API and the dashboard. Code against this document and the source files it names. Where the two disagree, the source file is right and this document has a bug: report it.

Do not change a contract on your own. If one is wrong or missing something, make the smallest additive change (a new optional field, a new route) and report it, so the owners of the other side hear about it.

| Contract | Source of truth |
|---|---|
| Frame record, sitting file | `packages/signal-engine/Sources/SignalEngine/FrameRecord.swift`, `SittingFile.swift` |
| Engine API | `packages/signal-engine/Sources/SignalEngine/SignalEngine.swift`, `Reading.swift`, `SittingSummary.swift`, `EngineConfiguration.swift` |
| Native module JavaScript API | `apps/mobile/modules/triage-capture/src/types.ts` |
| Every HTTP payload | `packages/contracts/src/*.ts` (zod schemas, imported as `@triagecam/contracts`) |
| Database | `apps/web/src/db/schema.ts` |
| Design tokens | `design-system/tokens.json`, generated into both apps by `pnpm tokens` |

Contents: 0 Repo and rules for everyone, 1 Frame record and sitting file, 2 SignalEngine API, 3 Native module API, 4 HTTP API, 5 Conventions (errors, pagination, time, units), 6 Server behaviour both sides rely on, 7 Database, 8 Design tokens, 9 Ports and dev servers.

## 0. Repo and rules for everyone

```
apps/web                      Next.js 16 (App Router, src/), Tailwind 4. The only backend.
  src/app/api/**              API routes (section 4)
  src/app/**                  Dashboard pages
  src/server/                 Server-only code. env.ts and http.ts exist; routes add their own modules here.
  src/db/                     Drizzle schema, client, migrations
  src/styles/tokens.css       Generated. Do not edit.
apps/mobile                   Expo SDK 58, expo-router (routes in src/app), development build, iOS only
  modules/triage-capture      Local Expo module: Swift capture + bridge to SignalEngine
  src/theme/                  tokens.ts is generated; index.ts has useTheme
  src/config.ts               apiUrl from EXPO_PUBLIC_API_URL
packages/contracts            zod schemas and types for every wire payload, plus route paths and shared copy
packages/signal-engine        Swift package SignalEngine (Accelerate only) + engine-cli
design-system                 The user's design system. Read-only.
scripts/build-tokens.mjs      tokens.json -> web CSS and mobile TypeScript
```

- **Imports.** `import { Reading, routes } from '@triagecam/contracts'` in both apps. Each schema and its inferred type share one name. In the mobile app the capture module is `import TriageCapture from 'triage-capture'` and app code is `@/…` (maps to `apps/mobile/src`). In the web app `@/…` maps to `apps/web/src`.
- **The dashboard reads data only through `/api`** (same origin, cookie session). It does not import from `src/server` or `src/db`. That is the seam that lets the API and the dashboard be built at the same time.
- **Route paths** come from `routes` in `@triagecam/contracts`, never from string literals.
- **The mobile app never assumes a host.** Every request is `apiUrl + routes.x`. `apiUrl` is an ngrok https URL during testing. Send the header `ngrok-skip-browser-warning: 1` on every request from the phone.
- **Native dependencies of the mobile app are fixed** to what `apps/mobile/package.json` lists now (expo-router, expo-dev-client, expo-font, expo-notifications, expo-secure-store, expo-device, expo-keep-awake, expo-constants, expo-linking, expo-build-properties, safe-area-context, screens, svg). Adding one means a new native build: report it instead of adding it mid-pass. JavaScript-only packages are fine.
- **Next.js configuration.** `cacheComponents` is off: pages and routes render on request. API routes that hold state in memory (live view, the readings stream) need the Node.js runtime, which is the default; do not opt them into the edge runtime. Next 16 differs from older versions: read `node_modules/next/dist/docs/` before using an API you have not checked.
- **Schema changes** go through `apps/web/src/db/schema.ts` and `pnpm db:generate`, which writes one new SQL file. Only the API owner generates migrations; everyone else reports the column they need.
- **Copy.** `PRIVACY_CAPTURE`, `PRIVACY_FACE` and `PROTOTYPE_NOTICE` in `@triagecam/contracts` are shown word for word. `PROTOTYPE_NOTICE` appears once per app, under the sign-in form, and nowhere else. The live view exists and a profile photo is kept, so nothing may say "no video leaves the phone" or "no picture is stored". The sentence is "Video is shown live to staff and is not stored. One profile photo is kept with the patient record."

## 1. Frame record and sitting file

### Frame record

One camera frame reduced to numbers. It is the only thing the capture module hands to the engine, and one line of a sitting file. Swift type `FrameRecord`; zod schema `FrameRecord`.

| Field | JSON type | Unit and meaning |
|---|---|---|
| `t` | number | Seconds on the capture clock: the frame's presentation timestamp on the host time base. Monotonic, strictly increasing within a sitting. Not wall-clock time. |
| `facePresent` | boolean | A face is tracked in this frame. When false, the three colour means and `faceTrackId` are null. |
| `forehead` | `{r,g,b}` or null | Mean colour of the forehead region. See below. |
| `leftCheek` | `{r,g,b}` or null | The cheek on the left of the image as captured (the patient's right cheek on the rear camera). |
| `rightCheek` | `{r,g,b}` or null | The cheek on the right of the image as captured. |
| `chestMotion` | number or null | Vertical displacement of the upper-chest region between the previous delivered frame and this one, as a fraction of frame height. Positive is downward in the image. Null on the first frame of a sitting and whenever the region cannot be tracked. |
| `exposure` | `"adjusting"` or `"locked"` | `locked` once shutter, ISO, white balance and focus are fixed. While `adjusting`, colour means are not comparable between frames. |
| `droppedFrames` | integer | Frames the camera dropped since the sitting started. Cumulative, never decreases. |
| `faceTrackId` | integer or null | Identifies the tracked face. A new value means a different or re-acquired face, and the engine resets its history. |

- **Region colour** `{r, g, b}`: each channel is the arithmetic mean of the 8-bit channel values (0 to 255, so fractional means such as 136.42) of every pixel inside the region, after conversion of the camera's `420f` output to full-range RGB. No gamma change, white-balance correction or normalisation by the capture module.
- **Regions** are anchored to face landmarks and smoothed over time by the capture module (plan section 7, requirement 8). A rectangle over the face box is not acceptable.
- **Null and missing mean the same** in the file. Swift's encoder leaves nil keys out.
- A frame the camera delivered is always written, face or no face. A frame the camera dropped is never written; it only raises `droppedFrames`, and shows as a gap in `t`.

### Sitting file

JSON Lines, UTF-8, `\n` line ends, extension `.jsonl`. Line 1 is the header; every following line is one frame record, in capture order. Read and write it only with `SittingFile` / `SittingFileWriter` in the SignalEngine package.

```
{"captureStart":1000,"format":"triagecam.sitting","nominalFrameRate":60,"sittingId":"6f1c…","source":"camera","startedAt":"2026-11-14T03:21:07.512Z","version":1}
{"droppedFrames":0,"exposure":"adjusting","facePresent":false,"t":1000}
{"chestMotion":-0.0003,"droppedFrames":0,"exposure":"locked","facePresent":true,"faceTrackId":1,"forehead":{"b":118.2,"g":136.4,"r":182.1},"leftCheek":{…},"rightCheek":{…},"t":1002.0167}
```

| Header field | Meaning |
|---|---|
| `format` | Always `"triagecam.sitting"` |
| `version` | Always `1` |
| `sittingId` | Server id of the sitting, or null for a recording made without the server |
| `source` | `"camera"` or `"simulated"` |
| `nominalFrameRate` | Requested frames per second |
| `startedAt` | Phone wall clock at the first frame, ISO 8601 UTC |
| `captureStart` | Capture-clock time of the first frame. `t - captureStart` is seconds into the sitting; `startedAt + (t - captureStart)` is the wall-clock time of any frame. |
| `note` | Optional free text: what was recorded ("wall", "resting", "after stairs") |

A 60 second sitting at 60 fps is about 3600 lines and under 1 MB. The file holds numbers only.

## 2. SignalEngine public API

Swift package `SignalEngine` at `packages/signal-engine`, tools version 6.0, iOS 16+ and macOS 13+, Accelerate only. The public types below are complete and compile today; `SignalEngine`'s method bodies currently return "no reading" (`settling` / `warming_up`, or `stale` / `no_frames` after silence) and are where the maths goes. Signatures and the meaning of every field stay as they are.

```swift
public final class SignalEngine {
  public let configuration: EngineConfiguration
  public init(configuration: EngineConfiguration = .default)
  public func ingest(_ frame: FrameRecord)          // every frame, in capture order
  public func reading(at t: Double? = nil) -> Reading
  public func finish() -> SittingSummary
  public func reset()
}
```

- One engine per sitting. Not thread-safe: call every method from the same queue.
- `ingest` ignores a frame whose `t` is not greater than the previous frame's.
- `reading(at:)` takes "now" on the capture clock. The capture module calls it once per second with the real current time, not the last frame's time: that is the independent freshness timer, and it is how a silent camera turns into `stale`. `nil` means the newest frame's time (used offline).
- `finish()` returns the summary for everything ingested since creation or `reset()`.

```swift
public struct Reading { var t: Double; var elapsed: Double; var heartRate: Estimate; var breathingRate: Estimate }
public struct Estimate { var value: Double?; var state: EstimateState; var reason: EstimateReason?;
                         var quality: Double; var coverage: Double; var ageMs: Int? }
public enum EstimateState: String { case settling, valid, none, stale }
```

| `Estimate` field | Meaning |
|---|---|
| `value` | Heart rate in bpm or breathing rate in breaths per minute. Set if and only if `state` is `valid`. Never the last good value. |
| `state` | `settling`: history is accumulating and nothing has been accepted since the last reset. `valid`. `none`: the engine looked and declined. `stale`: no frame for longer than `staleAfterSeconds` (2 s). |
| `reason` | Null if and only if `state` is `valid`. One of the strings below. |
| `quality` | 0 to 1, scored at the frequency that is reported. 0 when there is no candidate. An estimate is valid only at or above `qualityThreshold`. |
| `coverage` | 0 to 1: share of the one-second readings since the first frame in which this estimate was valid. |
| `ageMs` | Milliseconds since this estimate was last valid. 0 while valid. Null if it has not been valid in this sitting. |

`Reading.t` is capture-clock seconds; `Reading.elapsed` is seconds since the first frame.

| `reason` | When |
|---|---|
| `warming_up` | Not enough history for a first window (`settling`) |
| `awaiting_agreement` | Windows exist but three consecutive ones have not agreed yet (`settling`) |
| `no_face` | No face in the frame |
| `face_changed` | `faceTrackId` changed and history was reset |
| `exposure_adjusting` | Exposure is not locked |
| `low_quality` | Quality at the reported frequency is under the threshold |
| `motion` | Motion made part of the analysis window unusable |
| `gaps` | The window has gaps or too few samples |
| `band_edge` | The peak is at the edge of the search band |
| `no_chest` | The chest region is not tracked (breathing only) |
| `no_frames` | Frames stopped arriving (always with `stale`) |

```swift
public struct SittingSummary {
  var durationSeconds: Double; var frameCount: Int; var droppedFrames: Int
  var heartRate: SummaryValue       // bpm, median of valid one-second readings
  var breathingRate: SummaryValue   // breaths per minute, likewise
  var rmssd: SummaryValue           // ms, experimental
  var sdnn: SummaryValue            // ms, experimental
  var beatIntervals: [BeatInterval] // accepted intervals after outlier rejection, in time order
  var timeToFirstReadingSeconds: Double?
  var longestDropoutSeconds: Double
}
public struct SummaryValue { var value: Double?; var coverage: Double }  // value nil = "No reading"
public struct BeatInterval { var tMs: Double; var ms: Double }           // tMs: ms from first frame to the beat ending the interval
```

For heart and breathing rate, `coverage` is the share of one-second readings that were valid. For RMSSD and SDNN it is the share of the sitting spanned by accepted beat intervals; the engine sets `value` to nil when that share is too low to report.

`EngineConfiguration` carries the plan's numbers as defaults: `nominalFrameRate` 60, `heartRateBandHz` 0.7...3.0, `heartRateSearchBpm` 42...180, `breathingBandHz` 0.1...0.7, `qualityThreshold` 0.5 (to be calibrated on negative controls), `agreeingWindows` 3, `agreementToleranceBpm` 5, `staleAfterSeconds` 2. Fields may be added; these keep their names.

Also in the package, already implemented:

- `SittingFile.read(from:)`, `.write(_:to:)`, `.encode`, `.decode`, and `SittingFileWriter(url:header:)` with `append(_:)` and `close()`.
- `SyntheticSitting`: deterministic frame records for a chosen heart rate, breathing rate, duration and seed (`frames()`, `contents(sittingId:startedAt:)`). The engine's tests and the simulated capture source both use it.
- `engine-cli run <sitting.jsonl>` prints one `Reading` per second as JSON Lines, then the `SittingSummary`. `engine-cli synth <out.jsonl> [--hr 72] [--br 16] [--seconds 60] [--fps 60] [--seed 1]` writes a synthetic sitting file.

**Linking into the app.** `packages/signal-engine/SignalEngine.podspec` builds the same sources as a pod. `apps/mobile/app.json` adds it to the Podfile through `expo-build-properties` (`ios.extraPods`, path `../../../packages/signal-engine` relative to `apps/mobile/ios`), and `TriageCapture.podspec` depends on it, so the module's Swift files `import SignalEngine`. Keep every engine source file directly in `Sources/SignalEngine` (no subfolders): the podspec globs that one directory.

## 3. Native module JavaScript API

`import TriageCapture, { type ReadingEvent } from 'triage-capture'`. Types: `apps/mobile/modules/triage-capture/src/types.ts`. The Swift module is named `TriageCapture` and declares the five events; its functions are the capture work.

Until the Swift functions exist in the build, `TriageCaptureModule.ts` hands back `TriageCaptureStub` (`src/stub.ts`), a JavaScript stand-in that plays a fixed script (face at 2 s, heart rate valid from 11 s, breathing from 30 s) so screens can be built first. It measures nothing and `getSource()` returns `'stub'`.

### Functions

| Function | Returns | Notes |
|---|---|---|
| `getSource()` | `'camera' \| 'simulated' \| 'stub'` | Synchronous. Screens label anything but `camera`. |
| `getCameraPermission()` | `Promise<'granted' \| 'denied' \| 'undetermined'>` | `granted` for simulated and stub |
| `requestCameraPermission()` | same | |
| `startCapture(options?)` | `Promise<void>` | `{ camera?: 'back' \| 'front', frameRate?: 30 \| 60 }`. `camera` defaults to the one last chosen with `setCamera` (back until someone flips it), `frameRate` to 60. Starts the camera and face tracking; `onStatus` and `onFaceRegions` begin. Safe to call twice. |
| `getCamera()` | `'back' \| 'front'` | Synchronous. The camera capture starts on. Kept between launches (`UserDefaults`; the stub keeps it until the app restarts). |
| `setCamera(camera)` | `Promise<void>` | Remembers the choice and, while capture runs, swaps the session's input at once. The capture clock, the dropped-frame count, the live view and a running sitting carry on; exposure is metered afresh and the face comes back under a new `faceTrackId`, so the engine resets its history. The screens only offer the flip while framing, before a sitting starts. Rejects with `ERR_CAMERA_UNAVAILABLE` and stays on the working camera when the phone has no such camera. |
| `stopCapture()` | `Promise<void>` | A running sitting is abandoned and its file deleted. |
| `startSitting({ sittingId })` | `Promise<{ sittingId, startedAt }>` | `sittingId` from `POST /api/sittings`. Creates the engine and the sitting file on the next frame; `onReading` begins. `startedAt` is the phone wall clock at the first frame. |
| `stopSitting()` | `Promise<SittingResult>` | `{ sittingId, endedAt, summary, fileUri }`. `summary` is `SignalEngine.finish()` unchanged and is the body of the finish request. `fileUri` is a `file://` URI, or null from the stub. The caller decides when 60 seconds are up. |
| `deleteSittingFile(fileUri)` | `Promise<void>` | After upload, or when the file is not wanted |
| `setLivePreview(options)` | `Promise<void>` | `{ enabled, fps?: 1 to 30 (default 2), maxLongSide?: up to 640 (default 480), quality?: 0 to 1 (default 0.5), uploadUrl?, uploadHeaders? }`. Off by default. With `uploadUrl` (the absolute live-view frame route) the module posts each frame itself as a raw `image/jpeg` body with `uploadHeaders`, at most two in flight and the rest dropped, and reports through `onLiveUpload`; without it, frames arrive as `onPreviewFrame`. Frames are never written to disk. |
| `captureFaceCrop()` | `Promise<{ jpegBase64, width, height }>` | The tracked face from the current frame, at most 512 px on the long side. Sent once per check-in sitting as a fallback profile photo (`PUT /api/patients/:number/photo`, kept only when the patient has none), and for face enrolment when the patient opted in. |
| `addListener(name, listener)` | `{ remove() }` | |

Every promise rejects with an `Error` whose `code` is one of `ERR_CAMERA_PERMISSION`, `ERR_CAMERA_UNAVAILABLE`, `ERR_CAPTURE_INTERRUPTED`, `ERR_NOT_CAPTURING`, `ERR_SITTING_RUNNING`, `ERR_NO_SITTING`, `ERR_NO_FACE`, `ERR_FILE`.

### Events

Optional values cross the bridge as `null`, never as a missing key (the zod schemas on the server reject `undefined`).

| Event | Rate | Payload |
|---|---|---|
| `onReading` | Once per second during a sitting | `{ sittingId, reading }`. `reading` is the wire `Reading` (section 4), ready to post: `t` is the phone wall clock in ISO 8601 UTC (`startedAt + (engine t - captureStart)`), `elapsedMs` is `round(elapsed * 1000)`, `heartRate` and `breathingRate` are the engine's `Estimate`s with nil written as null. |
| `onStatus` | Once per second while capture runs | `{ source, fps, droppedFrames, exposureLocked, thermalState, facePresent, viewfinder, sittingId, sittingElapsedMs }`. `fps` is frames delivered in the last second. `droppedFrames` counts from the sitting's start, or from capture start when none is running. `thermalState` is `nominal`, `fair`, `serious` or `critical`. `viewfinder` is `searching`, `locking`, `measuring` or `lost`, the states of the design system's `Viewfinder`. |
| `onFaceRegions` | About 10 per second while capture runs | `{ aspectRatio, face, forehead, leftCheek, rightCheek, chest }`. `face` and `chest` are `{ x, y, width, height }`; the three skin regions are closed polygons of 4 to 12 `{ x, y }` points. All are null when not tracked. |
| `onPreviewFrame` | The rate set by `setLivePreview`, only when it has no `uploadUrl` | `{ jpegBase64, width, height, t }`: the wire `LiveFrame`. Post it to the live-view route as it is. The stub uses this path. |
| `onLiveUpload` | Once per second while the module uploads frames itself | `{ delivered, failed, viewers }`: frames the server accepted and refused in the last second, and the dashboards watching (null when nothing was accepted). |
| `onError` | When something fails outside a call | `{ code, message }` |

**Coordinates** are normalised to the camera frame as captured and shown upright: x to the right, y down, both 0 to 1, origin at the top-left corner. `aspectRatio` is that frame's width divided by its height. They are never mirrored, on either camera.

### Preview view

`import { CapturePreview } from 'triage-capture'` is a native view (`ios/CapturePreviewView.swift`) that draws the live picture with `AVCaptureVideoPreviewLayer` straight from the capture session: no frame crosses the bridge. It has no props beyond `style`, fills its box and crops the overflow (`resizeAspectFill`), and shows the front camera mirrored. The viewfinder draws the framing template and the outlines over it with the same cover arithmetic (`apps/mobile/src/lib/capture/viewfinderGeometry.ts`), flipping the outlines' x when the front camera is chosen, because only the picture is mirrored: frame records, outlines, the face crop and the frames uploaded to the live view stay as captured. On the simulator the view shows the test pattern (mirrored for `front`, so the flip can be seen). `hasNativePreview` and `hasCameraControls` are false in a development build made before the view and `setCamera` existed, and the viewfinder then falls back to outlines on a dark field with no flip control.

### Simulated source

On the iOS simulator there is no camera, so the Swift module switches by itself (`#if targetEnvironment(simulator)`) to a simulated source: it generates frames with `SyntheticSitting` at the nominal rate in real time and feeds them through the same `SignalEngine`, sitting file writer and event path as camera frames. `getSource()` returns `'simulated'`, the sitting file header says `"source":"simulated"`, and the sitting is created on the server with `source: 'simulated'`.

- `onFaceRegions` reports fixed plausible outlines; `onStatus` reports the generator's frame rate with `exposureLocked` following the synthetic frames.
- `setCamera` keeps the choice and changes nothing that is generated; `CapturePreview` shows the test pattern.
- `onPreviewFrame` and `captureFaceCrop()` return a generated flat or test-pattern JPEG, never a face. The server will answer `no_face_detected` to that crop, which is the expected result on the simulator.

## 4. HTTP API

All routes are under `/api` on the Next.js server. Bodies are JSON (`Content-Type: application/json`) unless a row says otherwise. Schemas are in `packages/contracts/src`; the name in the table is the exported schema and type. Conventions for errors, pagination, time and units are in section 5.

### Health

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/health` | public | none | 200 `HealthResponse` `{ status: 'ok' }` when the server can open a new connection to its database and run a query on it within 3 seconds; 503 `{ status: 'unavailable' }` when it cannot. Never cached. |

This is the load balancer's health check (`docs/DEPLOY.md`). It does not read a session, so it does not start the background jobs of section 6, and it opens its own connection rather than borrowing one from the pool, so it also fails when the database password the process was started with has stopped working.

### Authentication

- **Web:** an httpOnly cookie named `tc_session` (`SESSION_COOKIE`), `SameSite=Lax`, `Path=/`, `Secure` when `APP_URL` is https, lifetime 7 days.
- **Mobile:** `Authorization: Bearer <token>`, lifetime 30 days. The app keeps the token in `expo-secure-store`.
- A request with both uses the bearer token. The token is 32 random bytes, base64url; the database stores only its SHA-256 (hex).
- Passwords: 8 characters or more and at most 72 bytes, hashed with bcrypt (cost 12).
- Email verification: the server emails `${APP_URL}/verify-email?token=<token>` through Resend. The token is 32 random bytes, stored as SHA-256, valid for 24 hours, single use. The dashboard page `/verify-email` posts the token to the verify route. **Without `RESEND_API_KEY` and outside production**, nothing is sent: the server logs the link and returns the raw token as `devVerificationToken`, so development and tests need no mailbox.
- Accounts are staff only. An unverified account cannot sign in.
- **When a session ends under the dashboard** (any request answers 401 `unauthenticated` while it is open), the app shell goes to `/sign-in?next=<page>&reason=<why>`. `reason` is `expired`, or `unsaved` when the refused request was a change (anything but a `GET`), which was therefore not made; the sign-in form says so in one sentence (`apps/web/src/lib/session-ended.ts`) and ignores any other value. Opening the dashboard signed out, and signing out on purpose, carry no `reason`.

"Auth" below: **public** needs no session; **staff** needs a session of a verified user, else 401 `unauthenticated`.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/auth/sign-up` | public | `SignUpRequest` `{ email, password }` | 201 `SignUpResponse` `{ user, devVerificationToken? }`. 409 `email_taken`. |
| `POST /api/auth/verify-email` | public | `VerifyEmailRequest` `{ token }` | 200 `VerifyEmailResponse` `{ user }`. 410 `token_invalid` when unknown, used or expired. |
| `POST /api/auth/resend-verification` | public | `ResendVerificationRequest` `{ email }` | 200 `ResendVerificationResponse` `{ ok: true, devVerificationToken? }`. Always 200, whether or not the address has an account. |
| `POST /api/auth/sign-in` | public | `SignInRequest` `{ email, password, client: 'web' \| 'mobile' }` | 200 `SignInResponse` `{ user, token?, expiresAt }`. `web` sets the cookie and omits `token`; `mobile` returns `token` and sets no cookie. 401 `invalid_credentials`, 403 `email_not_verified`. |
| `POST /api/auth/sign-out` | staff | none | 204. Deletes the session; clears the cookie. |
| `GET /api/auth/me` | staff | none | 200 `MeResponse` `{ user, session: { kind, expiresAt } }` |

`User` is `{ id, email, emailVerified, createdAt }`.

### Devices

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/devices` | staff | `RegisterDeviceRequest` `{ id?, role: 'camera' \| 'nurse', label, expoPushToken? }` | 200 `DeviceResponse` `{ device }`. Without `id` it creates a device; with the caller's own `id` it updates role, label and token and refreshes `lastSeenAt`. 404 `not_found` for someone else's `id`. |
| `GET /api/devices` | staff | none | 200 `DeviceListResponse` `{ devices }`, all devices, most recently seen first |

`Device` is `{ id, role, label, hasPushToken, lastSeenAt, liveAt }`. `liveAt` is when a camera device last posted a live-view frame, or null if that was more than 5 seconds ago. The phone registers at role choice, stores the returned `id`, and registers again with that `id` whenever the role or push token changes. The push token is never returned.

### Patients

A patient is one visit to the waiting room. The record is created empty the moment intake starts on a camera phone, and is filled in from the dashboard's check-in page while the first sitting runs. On screen the photo and the name lead; the short visit number (`number`) addresses the patient in every URL (`/api/patients/14`) and shows as secondary text ("No. 14"). No payload carries a patient's database id.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/patients` | staff | `CreatePatientRequest`: any subset of the intake fields, and `faceOptIn?` (default false). `{}` is the normal body from the phone. | 201 `PatientResponse` `{ patient }` |
| `GET /api/patients` | staff | Query `PatientListQuery`: `status=waiting\|discharged\|all` (default `waiting`), `limit`, `cursor` | 200 `PatientListResponse` `{ items, nextCursor }`, newest first |
| `GET /api/patients/:number` | staff | none | 200 `PatientDetailResponse` `{ patient, state, baseline, sittings, flags, timeline, handoff }` |
| `PATCH /api/patients/:number` | staff | `UpdatePatientRequest`: any subset of the intake fields, `faceOptIn?`, `intakeComplete?` | 200 `PatientResponse`. A field left out keeps its value; `null` or an empty string clears it. The check-in page sends this as staff type (about 0.4 s after the last key), so it is cheap and safe to repeat. `faceOptIn: false` deletes the stored embedding; changing `faceOptIn` on a discharged patient is 409 `patient_discharged`, intake fields can still be corrected. |
| `POST /api/patients/:number/discharge` | staff | none | 200 `PatientResponse`. Sets status, closes open flags, deletes face embeddings. The name, intake details and photo stay. Calling it again returns the same patient. |
| `GET /api/patients/:number/photo` | staff | Optional query `v=<photoUpdatedAt>` | 200 `image/jpeg`, a 384 px square (`PATIENT_PHOTO_SIZE`). With `v` it is `Cache-Control: private, max-age=31536000, immutable`. 404 `not_found` when there is no photo. |
| `PUT /api/patients/:number/photo` | staff | `PatientPhotoRequest` `{ jpegBase64, replace? }`: the phone's face crop | 200 `PatientResponse`. Without `replace: true` it only fills a gap: the crop is dropped, and the unchanged patient returned, when there is already a photo or staff removed it. |
| `POST /api/patients/:number/photo/capture` | staff | `CapturePatientPhotoRequest` `{ deviceId }` | 200 `PatientResponse`. Cuts the portrait from the frame that camera phone is sending to the live view now. 409 `conflict` when the phone is not live, 422 `no_face_detected`, 503 `face_unavailable`. |
| `DELETE /api/patients/:number/photo` | staff | none | 204. The photo stays removed: automatic capture and the phone's crop do not put one back until staff take one (the capture route, or `PUT` with `replace: true`). |

`Patient` is the intake fields plus `{ number, status: 'waiting' \| 'discharged', createdAt, dischargedAt, intakeCompletedAt, photoUpdatedAt, faceOptIn, faceEnrolled }`.

| Intake field (`PatientIntake`) | Type | Meaning |
|---|---|---|
| `name` | string or null, at most 120 | Null until staff have typed it. Show `patientLabel(patient)`, which falls back to "Patient 14". |
| `dateOfBirth` | `YYYY-MM-DD` or null | A calendar date, no time or zone. A request must give one from 1900-01-01 (`EARLIEST_DATE_OF_BIRTH`) to today, or it is refused with 400 `invalid_request`. |
| `sex` | `'female' \| 'male' \| 'other'` or null | |
| `reasonForVisit` | string or null, at most 280 | The chief complaint |
| `painScore` | integer 0 to 10 or null | As the patient reports it |
| `allergies` | string or null, at most 280 | |
| `notes` | string or null, at most 2000 | Symptoms, history, medication |

Text is trimmed on the way in and an empty string is stored as null. `intakeCompletedAt` is stamped by `intakeComplete: true` and cleared by `false`; completing needs a name (in the record or in the same request), otherwise 400 `invalid_request`. `photoUpdatedAt` is when the profile photo was last stored, null when there is none, and the `v` to put on the photo URL.

**`PatientRef`** `{ number, name, photoUpdatedAt }` is enough to draw an avatar and a name. Every payload about one patient carries it as `patient`, beside the older `patientNumber`: `WorklistItem`, `Flag`, the `sitting_started` and `patient_changed` stream events, and a matched `MatchFaceResponse`. Clients show the photo at `routes.patientPhoto(number) + '?v=' + photoUpdatedAt` (the phone adds its bearer header) and initials when `photoUpdatedAt` is null.

**The profile photo** is taken once per patient, three ways, and is the only picture the system stores: (1) automatically, by the server, from the live-view frames during a sitting for a patient with no photo: about twice a second it looks for a face, and the first frame with a clear one is cropped and stored; (2) by the phone, which sends its own `captureFaceCrop()` once the viewfinder is measuring during a check-in sitting; it is a tight face box, so it is kept only when (1) has not stored a portrait; (3) by staff, with "Retake photo" on the check-in page (the capture route), which always replaces. "Remove" (`DELETE`) is final until staff take a photo again: the removal is recorded on the patient (`patients.photo_removed_at`), so it holds across a server restart, and neither (1) nor (2) stores a new one. A photo staff take clears it.

### Sittings

The order of calls for one sitting is in section 6.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/sittings` | staff | `StartSittingRequest` `{ patientNumber, deviceId, kind: 'check_in' \| 'recheck', source, clientTime }` | 201 `StartSittingResponse` `{ sitting, serverTime }`. The server stores `clockOffsetMs = server now - clientTime`. 404 unknown patient or device, 409 `patient_discharged`. An unfinished sitting of the same patient is ended without a summary first. |
| `POST /api/sittings/:id/readings` | staff | `PostReadingsRequest` `{ readings: Reading[] }`, 1 to 30 | 200 `PostReadingsResponse` `{ accepted }`. Once per second. A reading whose `t` is already stored is skipped, so a retry is safe. 409 `sitting_finished`. |
| `POST /api/sittings/:id/finish` | staff | `FinishSittingRequest` `{ endedAt, summary: SittingSummary }` | 200 `SittingResponse` `{ sitting }`. Stores the summary and beat intervals, then runs the trend rules. Calling it again returns the stored sitting. |
| `GET /api/sittings/:id` | staff | none | 200 `SittingDetailResponse` `{ sitting, readings, beatIntervals }` |
| `PUT /api/sittings/:id/file` | staff | Body is the sitting file itself, `Content-Type: application/x-ndjson`, at most 5 MB | 204. Saved as `<SITTING_FILES_DIR>/<id>.jsonl`. Development and pilot only: 403 `forbidden` when `NODE_ENV` is production. 413 `payload_too_large`. |

- `Reading` (phone to server): `{ t, elapsedMs, heartRate: Estimate, breathingRate: Estimate }`. `t` is the phone's wall clock; the server stores `t + clockOffsetMs`. `Estimate` is exactly the engine's (section 2), with `value` in bpm or breaths per minute.
- `StoredReading` (server to dashboard): `{ t, heartRate, breathingRate }` with `t` on the server clock.
- `Sitting`: `{ id, patientNumber, deviceId, kind, source, startedAt, endedAt, clockOffsetMs, summary }`. `startedAt` and `endedAt` are on the server clock. `summary` is null until finished, then `{ durationSeconds, heartRate, breathingRate, rmssd, sdnn, timeToFirstReadingSeconds, longestDropoutSeconds, frameCount, droppedFrames }` where the four vitals are `{ value, coverage }`.
- `source` is `camera`, `simulated`, `stub` or `recording` (a replayed sitting file). Anything but `camera` is labelled on every screen that shows the sitting.

### Worklist

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/worklist` | staff | none | 200 `WorklistResponse` `{ generatedAt, recheckIntervalMin, items }` |

Every waiting patient appears once, in rank order (`rank` 1 first). Clients do not sort. `WorklistItem`:

| Field | Meaning |
|---|---|
| `rank`, `patientNumber` | |
| `state` | `observed`, `flag`, `overdue` or `no-reading`. Rules in section 6. |
| `waitingSince` | Patient creation time |
| `lastObservedAt`, `minutesSinceObserved` | End of the last sitting that produced a valid heart or breathing rate; whole minutes since then at `generatedAt`. Both null if never observed. |
| `pulse`, `breathing` | `Trend` `{ base, now }`: the baseline sitting's value and the latest sitting's value, in bpm and breaths per minute. `now: null` means the latest sitting gave no reading for it. |
| `score`, `scoreAtCheckIn` | Partial NEWS2 band, 0 to 3: the higher of the two parameter bands. Null when nothing was measured. |
| `parametersMeasured` | 0, 1 or 2, for the "2 of 7 parameters" caption |
| `source` | Source of the latest sitting, or null |
| `flags` | Open `Flag`s, trend rules before overdue |
| `handoff` | The templated handoff sentence |
| `patient` | `PatientRef`: the name and photo for the row |
| `reasonForVisit`, `ageYears` | From intake; null until entered. `ageYears` is whole years from the date of birth. |
| `sittingInProgress` | A sitting is running for this patient |

### Flags

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/flags` | staff | Query `FlagListQuery`: `status=open\|closed\|all` (default `open`), `patient=<number>`, `limit`, `cursor` | 200 `FlagListResponse` `{ items, nextCursor }`, newest first |
| `POST /api/flags/:id/acknowledge` | staff | none | 200 `FlagResponse` `{ flag }`. Records who and when. Acknowledging twice changes nothing. Acknowledging does not close the flag. Acknowledging an open flag also acknowledges the other open flags of the same alert (same `alertId`) that nobody has acknowledged yet, and no flag of any other alert (section 6, Flag rules); each one gets its own `flag_acknowledged` event. The response carries the flag that was named. |

`Flag`: `{ id, patientNumber, rule: 'score_rise' \| 'baseline_shift' \| 'overdue', openedAt, closedAt, detail, acknowledgedAt, acknowledgedBy, handoff, alertId }`. `detail` (`FlagDetail`) holds the numbers the flag was raised on: `{ pulse: Trend, breathing: Trend, scoreAtCheckIn, scoreNow, minutesSinceCheckIn, minutesSinceObserved }`. `acknowledgedBy` is the staff member's email (the first to acknowledge). `alertId` says which alert the flag belongs to (section 6, Flag rules): an opaque string, compared for equality only. `flagAlerts(flags)` in `@triagecam/contracts` gathers a list of flags into `FlagAlert`s `{ id, flags, lead, waiting, acknowledgedAt, acknowledgedBy, closedAt }`; both apps use it and neither groups flags any other way.

### Settings

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/settings` | staff | none | 200 `SettingsResponse` `{ settings, updatedAt }` |
| `PATCH /api/settings` | staff | `UpdateSettingsRequest`: any subset of `Settings` | 200 `SettingsResponse` |

| `Settings` field | Default | Range | Meaning |
|---|---|---|---|
| `recheckIntervalMin` | 30 | 1 to 240 | Minutes without a valid observation before a patient is overdue |
| `pulseDeltaBpm` | 20 | 1 to 100 | Pulse movement from baseline that flags |
| `breathingDeltaPerMin` | 6 | 1 to 30 | Breathing movement from baseline that flags |
| `scoreRiseEnabled`, `baselineShiftEnabled`, `overdueEnabled` | true | | Turn each rule on or off |
| `notifyCooldownMin` | 10 | 0 to 240 | Minimum minutes between two pushes for one patient |
| `faceMatchMinConfidence` | 0.8 | 0 to 1 | Below this, a face match offers the waiting-room list instead |

### Statistics

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/statistics` | staff | Query `StatisticsQuery`: `from`, `to` (ISO 8601 UTC). Defaults: start of the server's local day, and now. | 200 `Statistics` |

What the waiting room did in the range, from data the system already holds. Nothing here compares the camera with another device: accuracy against contact sensors is measured on public recordings and shown on the landing page.

| Field | Meaning |
|---|---|
| `recheckIntervalMin` | The setting, to read the cadence against |
| `patients` | `seen` (in the waiting room at any moment of the range), `arrived`, `discharged`, `medianMinutesToFirstObservation` (arrival to the end of the first observation, patients who arrived in the range), `medianMinutesToDischarge` |
| `waitingNow` | The room at `generatedAt`, not limited to the range: `patients`, `byState` (a count per tile state), `medianMinutesWaiting`, `longestMinutesWaiting`, `medianMinutesSinceObserved`, `longestMinutesSinceObserved` (since arrival for a patient not yet observed) |
| `sittings` | Finished sittings started in the range: `finished`, `withReading` (the observations), `checkIns`, `rechecks`, `meanPerPatient`, `medianMinutesBetweenObservations`, `meanHeartRateCoverage`, `meanBreathingRateCoverage`, `medianTimeToFirstReadingSeconds` |
| `heartRate`, `breathingRate` | `RateDistribution` of the sitting summaries: `sittings`, `median`, `lowest`, `highest`, and `bins` `{ from, to, sittings }`. Bins are whole numbers, both ends inclusive, contiguous, and a rate is binned after rounding. Pulse bins are tens from 41 (51 to 90 is always present); breathing bins follow the partial NEWS2 bands: threes from 9 (12 to 20 is always present), 21 to 24 as one bin, then threes from 25. Empty when no sitting gave the rate. |
| `flags` | Counted in alerts (section 6, Flag rules), as the worklist, the patient page and the nurse app count: `raised` in the range, `acknowledged` (of those, the alerts a staff member acknowledged), `medianMinutesToAcknowledge` (from an alert opening to its first acknowledgement), and at `generatedAt`: `openNow`, `unacknowledgedNow` (open alerts still waiting for an acknowledgement). `byRule` is the one exception: how often each `FlagRule` tripped in the range, one per flag, so an alert that tripped both trend rules is under both and the three can add up to more than `raised`. The page prints it under its own heading, "Rules that tripped". |
| `perPatient` | One `PatientStatistics` per patient seen, waiting patients first, then longest in the room: `patientNumber`, `patient` (`PatientRef`), `status`, `state` (null once discharged), `arrivedAt`, `dischargedAt`, `minutesInRoom`, `minutesSinceObserved`, `sittings` and `observations` (in the range), `pulse` and `breathing` (`Trend`, as on the worklist), `heartRates` (every observation's, oldest first), `score`, `flags` (alerts raised in the range) |

A median or mean with nothing under it is null, never 0. Sittings whose source is `stub` are left out of every number here. Values are sent unrounded; screens round them (`apps/web/src/lib/format.ts`).

### Face match

The embedding is computed and compared on the server. The phone sends one face crop, and only for a patient whose `faceOptIn` is true. The crop is used in memory and not stored; the database keeps the embedding (`real[]`) and the model's name.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/patients/:number/face` | staff | `EnrolFaceRequest` `{ jpegBase64 }` | 201 `EnrolFaceResponse` `{ patientNumber, model }`. Replaces an earlier embedding for the patient. 403 `face_not_opted_in`, 409 `patient_discharged`, 422 `no_face_detected`. |
| `POST /api/face/match` | staff | `MatchFaceRequest` `{ jpegBase64 }` | 200 `MatchFaceResponse` `{ outcome, patientNumber, patient, confidence }`. `patient` is the matched `PatientRef`, so the phone can ask "Is this you?" by name. 422 `no_face_detected`. |
| `DELETE /api/patients/:number/face` | staff | none | 204, whether or not an embedding existed |

- `jpegBase64` has no `data:` prefix and is at most 400,000 characters.
- Matching compares against waiting, opted-in patients only, and only embeddings from the same model.
- `outcome` is `matched` (`patientNumber` set, `confidence` at or above `faceMatchMinConfidence`), `low_confidence` (someone resembles the crop but not surely; `patientNumber` is null and the screen offers the waiting-room list) or `no_match` (`confidence` null). A low-confidence guess is never disclosed.
- `confidence` is 0 to 1 for the best candidate. How cosine similarity maps onto it belongs to the face implementation and is stated beside the model.

### Live view

While a camera phone has its camera on for a sitting it posts JPEG frames, 15 a second. The server keeps only the newest frame per device, in memory, and relays it to the dashboards that are watching. Nothing is written to disk or to the database, with one deliberate exception: the profile photo (see Patients). This works only with one server process, which is how the app runs.

The transport is plain HTTP on the app's own port, so it works unchanged under `next dev`, `next start` and through an ngrok tunnel: one small POST per frame over a kept-alive connection from the phone, and one long multipart response to each dashboard. Measured on one machine with 640x480 frames of 25 kB: 15 fps on the dashboard, 4 ms median from capture to dashboard (95th percentile 6 ms), server relay 1 ms. `pnpm --filter @triagecam/web intake:sim` repeats the measurement.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/live/:deviceId/frame` | staff | Either the JPEG itself (`Content-Type: image/jpeg`, at most 300 kB, with the header `x-frame-captured-at: <phone clock, ms since the epoch>`), or the JSON `LiveFrame` `{ jpegBase64, width, height, t }` | 200 `PostLiveFrameResponse` `{ viewers }`. The device must be the caller's own camera device; the check is remembered for 10 seconds so it does not cost two queries per frame. 429 `rate_limited` above 30 frames a second. With `viewers` 0 and no sitting running the phone slows to 2 frames a second. |
| `GET /api/live/:deviceId/stream` | staff | none | 200 `multipart/x-mixed-replace; boundary=frame`: one `image/jpeg` part per frame, so `<img src>` shows it. Each part has `Content-Length` and the headers `x-frame-received-at` (server clock, ms), `x-frame-sequence`, and `x-frame-captured-at` when the phone sent it. Stays open; a reader that falls behind is sent only the newest frame, never a backlog. |

The dashboard reads the stream with `fetch`, cuts it into parts by `Content-Length` (`apps/web/src/lib/live-feed.ts`), decodes each JPEG with `createImageBitmap` and draws it on a canvas, skipping frames when decoding falls behind. It shows the frame rate and the server-to-screen delay beside the picture.

Limits (`LIVE_VIEW`): `fps` 15, `maxFps` 30 (the server's ceiling), `idleFps` 2, 640 px on the long side, JPEG quality 0.5, 300 kB a frame; a device with no frame for 5 seconds is no longer live. `LIVE_FRAME_HEADERS` names the three headers. `GET /api/devices` reports which camera devices are live through `liveAt`.

### Readings stream

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/stream` | staff | Optional query `patient=<number>` to receive only that patient's `reading` events | 200 `text/event-stream` |

Each event's `event:` field is the `type` and its `data:` is the whole `StreamEvent` object as JSON. A comment line (`: ping`) goes out every 15 seconds. `EventSource` reconnects by itself; on reconnect, refetch what the page shows, because events are not replayed.

| `type` | Payload | Sent when |
|---|---|---|
| `reading` | `{ sittingId, patientNumber, reading: StoredReading }` | A reading is stored |
| `sitting_started` | `{ sitting, patient }` | `patient` is the `PatientRef`, so the check-in page can show who sat down without another request |
| `sitting_finished` | `{ sitting }` | |
| `flag_opened`, `flag_acknowledged`, `flag_closed` | `{ flag }` | |
| `worklist_changed` | `{ at }` | Ranks or states may differ: refetch `GET /api/worklist` |
| `patient_changed` | `{ patientNumber, patient, at }` | A patient was created, discharged, renamed or photographed, or any intake field was saved. `patient` is the new `PatientRef`. Refetch `GET /api/patients/:number` for the other fields. |
| `live_changed` | `{ deviceId, live }` | A camera device started or stopped posting frames |

The dashboard uses this stream, and so does the nurse role of the mobile app (`apps/mobile/src/lib/nurse/eventStream.ts`, over `expo/fetch` with the bearer token, because React Native's own `fetch` cannot read a body as it arrives). The phone ignores `reading` and `live_changed`, and on any other event refetches `GET /api/worklist` and the open flags. Underneath it polls both: every 20 seconds while the stream is open, every 5 seconds while it is not. The stream is closed while the app is in the background; push covers that.

## 5. Conventions

### Errors

Every non-2xx response has this body (`ErrorResponse`), and nothing else:

```json
{ "error": { "code": "patient_discharged", "message": "Patient 14 has been discharged" } }
```

`message` is one plain sentence that is safe to show to staff. `details` is present for `invalid_request` and holds the zod issues. Codes and statuses (`ErrorCode`, `errorStatus`):

| Status | Codes |
|---|---|
| 400 | `invalid_request` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `email_not_verified`, `forbidden`, `face_not_opted_in` |
| 404 | `not_found` |
| 409 | `conflict`, `email_taken`, `patient_discharged`, `sitting_finished` |
| 410 | `token_invalid` |
| 413 | `payload_too_large` |
| 422 | `no_face_detected` |
| 429 | `rate_limited` |
| 500 | `internal` |

On the server, throw `new ApiError(code, message, details?)` and wrap each handler body in `try { … } catch (error) { return errorResponse(error) }` (`apps/web/src/server/http.ts`). `errorResponse` also turns a `ZodError` into `invalid_request` and anything else into `internal` without leaking its message.

### Pagination

List routes take `limit` (1 to 200, default 50) and `cursor`, and return `{ items, nextCursor }`. `nextCursor` is an opaque string to pass back as `cursor`, and null on the last page. The worklist and the device list are not paginated.

### Time

- Every timestamp on the wire is ISO 8601 in UTC with a trailing `Z` and milliseconds: `2026-11-14T03:21:07.512Z` (`Timestamp`). An offset such as `+01:00` is rejected.
- Two clocks exist. The **server clock** (the laptop) stamps everything it stores and everything the dashboard reads. The **phone clock** stamps `Reading.t`, `FinishSittingRequest.endedAt` and `LiveFrame.t`. The server converts with the sitting's `clockOffsetMs` (server minus phone, measured when the sitting starts, good to about the network delay).
- The **capture clock** (`FrameRecord.t`, the engine's `Reading.t`) never leaves the phone except inside a sitting file.
- Durations carry their unit in the name: `…Ms`, `…Seconds`, `…Min`.
- Screens show ages as whole minutes ("3 min ago") and clock times in the device's local zone.

### Units

| Quantity | Unit |
|---|---|
| Heart rate, pulse | Beats per minute (bpm), reported 42 to 180 |
| Breathing rate | Breaths per minute |
| Rates on screen | Rates travel as the engine computed them (71.763824). Every screen rounds to a whole number and prints the unit: "72 bpm", "16 /min" (web: `apps/web/src/lib/format.ts`). A change is the difference of the two rounded numbers. |
| RMSSD, SDNN, beat intervals | Milliseconds |
| Quality, coverage, confidence, shares | 0 to 1. Screens show a share as a percentage. |
| Region colour | Mean 8-bit channel value, 0 to 255 |
| Chest motion | Fraction of frame height per frame, positive downward |
| Outline coordinates | 0 to 1 of the upright frame, origin top-left |
| Patient (visit) number | Positive integer, sequential, never reused |
| Ids (sitting, device, flag, user) | UUID strings |

## 6. Server behaviour both sides rely on

### One sitting, end to end

1. Operator taps "Check in a new patient" (`POST /api/patients` with `{}`), or picks a waiting patient from the list for a re-check, or the phone matches a face (`POST /api/face/match`).
2. Phone: `startCapture()`. The viewfinder draws `onFaceRegions`.
3. Phone: `POST /api/sittings` with `clientTime`, then `startSitting({ sittingId })`.
4. Every second: `onReading` gives a `Reading`; the phone posts it to `/api/sittings/:id/readings`. If a post fails, keep the reading and send it with the next one (up to 30 per request).
5. The live view is on by default: the capture module posts frames to `/api/live/:deviceId/frame` itself (`setLivePreview` with `uploadUrl`), 15 a second. Staff watch them on the check-in page and type the intake form there (`PATCH /api/patients/:number`); the server takes the profile photo from them.
6. At 60 seconds (or when the operator stops): `stopSitting()`, then `POST /api/sittings/:id/finish` with `endedAt` and `summary`.
7. Once the viewfinder is measuring: `captureFaceCrop()`, then `PUT /api/patients/:number/photo` (check-in sittings), and `POST /api/patients/:number/face` if the patient opted in to face match and is not enrolled.
8. In development: `PUT /api/sittings/:id/file` with the file at `fileUri`, then `deleteSittingFile(fileUri)`.

The dashboard's check-in page follows the same sitting through `GET /api/stream` (`sitting_started`, `reading`, `sitting_finished`).

### Observations, baseline and score

- An **observation** is a finished sitting whose summary has a heart rate or a breathing rate. A finished sitting with neither is a "no reading" attempt.
- The **baseline** is the patient's first observation (normally the check-in sitting).
- **Parameter bands** (partial NEWS2): pulse 51 to 90 scores 0; 41 to 50 or 91 to 110 scores 1; 111 to 130 scores 2; 131 or above scores 3 (40 or below would score 3 but cannot be reported). Breathing 12 to 20 scores 0; 9 to 11 scores 1; 21 to 24 scores 2; 8 or below, or 25 or above, scores 3.
- A patient's **score** is the higher of its measured parameter bands, 0 to 3. Bands are not summed.

### Flag rules

A flag is one episode: it opens once, may be acknowledged, and closes. At most one flag per patient and rule is open at a time.

| Rule | Opens when | Closes when |
|---|---|---|
| `score_rise` | The two most recent observations both score higher than the baseline | An observation does not score higher than the baseline, or discharge |
| `baseline_shift` | On the two most recent observations, pulse differs from baseline by more than `pulseDeltaBpm` or breathing by more than `breathingDeltaPerMin` | An observation is within both thresholds, or discharge |
| `overdue` | No observation for longer than `recheckIntervalMin` (counted from patient creation if there has been none) | An observation arrives, or discharge |

Trend rules run when a sitting is finished. Overdue is checked by the server on a timer of at most 30 seconds and whenever the worklist is computed; both checks run every rule, so either may be the one that opens a trend flag.

**Alerts: what counts as one deterioration.** A nurse is told about, counts and acknowledges alerts, not rules. The server decides which flags are one alert and says so in `Flag.alertId`; the dashboard and the nurse app group by it (`flagAlerts`) and by nothing else. An alert's flags are always in one order, `FLAG_RULE_ORDER` (`score_rise`, `baseline_shift`, `overdue`): `flagAlerts` sorts them, and cards, badges and timeline rows name the rules in it.

- The trend flags (`score_rise`, `baseline_shift`) that **one sitting** raises for a patient are one alert. They open in the same request with the same `openedAt`, the same numbers and the same handoff sentence. With the default settings one deterioration usually trips both rules, so this is the normal case. Any request may be the one that opens them (the sitting's finish, a worklist being computed, the overdue timer), so flags are opened and closed under a per-patient lock: whichever request holds it reads the patient again and opens every flag that is due at one instant, and the others find them open (`applyRules`, `apps/web/src/server/trend/apply.ts`).
- A trend flag that opens on a **later sitting** is another alert, even while the earlier flag is still open: it was raised on other numbers, and a nurse who acknowledged the earlier ones has not seen these.
- An `overdue` flag is always an alert on its own.

They stay separate flags in the database, one per rule, each with its own episode; what follows from the grouping:

- One push goes out per deterioration (the cool-down below).
- One acknowledgement covers the alert and nothing else: acknowledging any open flag also acknowledges the other open, unacknowledged flags with the same `alertId`. A flag of another alert is never acknowledged by it.
- Every screen shows an alert once: one card naming each rule it tripped with one Acknowledge (dashboard patient page, nurse Flags tab and patient screen), one banner in the nurse app, and "to acknowledge" counts (nurse Flags tab and its badge, nurse worklist card) count alerts. An alert is acknowledged when all of its flags are (`FlagAlert.acknowledgedAt`).
- Statistics count alerts too (`flagStatistics`, which groups with `flagAlerts`): `flags.raised`, `acknowledged`, `openNow`, `unacknowledgedNow` and each patient's `flags`. One deterioration acknowledged once is 1 raised and 1 acknowledged there, as on every other screen. Only `flags.byRule` counts flags, one per rule, because it reports which rules fire, and the page labels it as that.

The patient timeline (`PatientDetailResponse.timeline`) is newest first. Entries at the same instant are in causal order: read oldest first, a sitting comes before the flags it closed and opened, and those before an acknowledgement. An acknowledgement that covered several flags of an alert is one `flag_acknowledged` entry, carrying the id of one of them. `flag_opened` and `flag_closed` entries are one per flag and carry the flag's `alertId`; clients pass the timeline through `timelineByAlert`, which keeps one entry where flags of an alert opened (or closed) in the same instant, so a deterioration reads as one "Flag opened" row.

### Tile state and rank

A waiting patient's state is the first that applies:

1. `flag`: a `score_rise` or `baseline_shift` flag is open.
2. `no-reading`: the latest finished sitting was a "no reading" attempt.
3. `overdue`: an `overdue` flag is open.
4. `observed`: otherwise. A patient with no sitting yet is `observed` with `lastObservedAt` and `minutesSinceObserved` null until it becomes overdue; screens say "Not yet observed" for it.

Rank order: all `flag` patients first (higher `score` first, then the flag that opened earliest); then `overdue` and `no-reading` patients together, longest time since the last observation first; then `observed` patients, longest time since the last observation first.

### Handoff sentence and push

- The handoff sentence is built on the server from a fixed template and sent as a string; clients show it as it is. It opens with `patientLabel(patient)`. Every number carries its unit and times use the dashboard's form ("26 min", "1 h 15 min", "just now"). Example: "Maya Chen: pulse 82 bpm at check-in, 108 bpm now (26 min later); breathing 16 to 24 breaths per min. Last observed 3 min ago." A flag keeps the numbers it was raised on, but its opening words follow the patient's current name.
- When a flag opens, the server sends one push through Expo's push service to every `nurse` device that has a token, unless a push for the same patient went out within `notifyCooldownMin`. Title: "Trend flag: Maya Chen" (or "Overdue: Maya Chen"). Body: the handoff sentence. `data`: `{ flagId, patientNumber }`.
- The nurse role shows the same alert in the app whether or not the push arrives: one banner per alert, however many rules it tripped, and not for alerts that were already open when the app started or that were opened from a tapped push.

### Not in this pass

LLM suggestions, collapse detection, video-visit mode, the public-dataset harness and the Core ML comparison. `HandoffNote` is rendered with no draft. Nothing in the contracts reserves fields for them.

## 7. Database

Postgres 17 on this Mac, database `triagecam`, `DATABASE_URL=postgres://localhost:5432/triagecam`. Schema: `apps/web/src/db/schema.ts`. Client: `import { db, schema } from '@/db/client'`. Migrations: `apps/web/src/db/migrations`.

- `pnpm db:migrate` applies migrations and makes sure the single `settings` row exists. `pnpm db:reset` drops everything and migrates again (local databases only). `pnpm db:generate` writes a migration after a schema change.
- For tests that must not disturb the shared database, create your own (`createdb triagecam_<name>`) and run with `DATABASE_URL` set to it; a variable in the shell wins over `.env.local`.

| Table | Holds |
|---|---|
| `users` | `email` (unique, lower case), `password_hash`, `email_verified_at` |
| `email_verification_tokens` | `user_id`, `token_hash` (unique), `expires_at` |
| `sessions` | `token_hash` (unique), `user_id`, `kind` web or mobile, `expires_at` |
| `devices` | `user_id`, `role` camera or nurse, `label`, `expo_push_token`, `last_seen_at` |
| `patients` | `number` (identity, unique), `status`, `created_at`, `discharged_at`, `face_opt_in`, and intake: `name`, `date_of_birth` (date), `sex` (enum `patient_sex`), `reason_for_visit`, `pain_score` (smallint), `allergies`, `notes`, `intake_completed_at`, `photo_updated_at`, `photo_removed_at` (set when staff remove the photo, cleared when staff take one; migration `0003_photo_removed_at`). Every intake column is nullable. Renamed from `tickets` by migration `0001_patients`; `sittings`, `readings`, `flags` and `face_embeddings` point at it through `patient_id`. |
| `patient_photos` | One row per patient with a photo: `patient_id` (primary key), `jpeg bytea` (a 384 px square), `width`, `height`, `created_at`. Kept out of `patients` so listing patients never reads image bytes. |
| `sittings` | `patient_id`, `device_id`, `kind`, `source`, `started_at`, `ended_at`, `clock_offset_ms`, and the summary: `duration_seconds`, `heart_rate`, `heart_rate_coverage`, `breathing_rate`, `breathing_rate_coverage`, `rmssd`, `rmssd_coverage`, `sdnn`, `sdnn_coverage`, `time_to_first_reading_seconds`, `longest_dropout_seconds`, `frame_count`, `dropped_frames` |
| `readings` | `sitting_id`, `patient_id`, `t`, then the heart-rate estimate as `heart_rate`, `state`, `reason`, `quality`, `coverage`, `age_ms` and the breathing estimate as `breathing_rate`, `breathing_state`, `breathing_reason`, `breathing_quality`, `breathing_coverage`, `breathing_age_ms`. Unique on (`sitting_id`, `t`). |
| `beat_intervals` | One row per sitting: `intervals_ms real[]` and `beat_times_ms real[]`, parallel arrays |
| `flags` | `patient_id`, `rule`, `opened_at`, `closed_at`, `detail jsonb` (`FlagDetail`), `last_notified_at`. One open flag per patient and rule. |
| `acknowledgements` | `flag_id`, `user_id`, `at`. One per flag and user. |
| `face_embeddings` | `patient_id`, `vector real[]` (L2-normalised), `model`, `created_at` |
| `settings` | Single row, `id` 1: the `Settings` fields and `updated_at` |

`reference_readings` and its `reference_source` enum were dropped by migration `0002_drop_reference_readings`: the product has no reference device.

All times are `timestamptz` on the server clock. No table stores video. The only stored picture is the profile photo in `patient_photos`.

## 8. Design tokens

`pnpm tokens` runs `scripts/build-tokens.mjs`, which reads `design-system/tokens.json` and writes both outputs. Neither is edited by hand.

**Web** (`apps/web/src/styles/tokens.css`, imported by `globals.css`):

- Both Atkinson Hyperlegible fonts are served from `design-system/fonts` by `@font-face`.
- The design system's own variable names are defined on `:root` (`--surface`, `--ink`, `--space-4`, `--radius-md`, `--control-md`, `--shadow-overlay`, `--font-sans`, …), so `design-system/components/bundle.css` works as written. Dark values apply under `prefers-color-scheme: dark` and under any `data-theme="dark"` ancestor; `data-theme="light"` forces light.
- Tailwind's default palette, spacing scale, radii, shadows and font sizes are removed. What exists:

| Kind | Classes |
|---|---|
| Colour | Every colour token by name: `bg-surface`, `bg-surface-raised`, `text-ink`, `text-ink-muted`, `border-line`, `border-line-strong`, `bg-signal`, `text-on-signal`, `bg-flag-soft`, `text-flag`, `bg-overdue`, `text-on-overdue`, `bg-score-2`, `outline-focus`, `bg-scrim`, … |
| Spacing | Steps 0 to 8 are the design system's: `p-4` is `space-4` (16px), `gap-5` is 24px, `p-6` is 32px, `mt-7` is 48px, `p-8` is 64px. There is no `p-10` or `p-12`. Sizes: `h-control-md` (36px), `h-control-touch` (48px), `w-nav` (216px), `max-w-phone` (390px). |
| Radius | `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 10px, `rounded-xl` 16px, `rounded-pill` |
| Shadow | `shadow-overlay` only |
| Type | One class per type style, setting family, size, line height, weight and tracking together: `type-title`, `type-heading`, `type-subheading`, `type-body`, `type-body-touch`, `type-body-strong`, `type-label`, `type-caption`, `type-readout-xl`, `type-readout-lg`, `type-readout-md`. Also `font-sans`, `font-mono`, `font-normal`, `font-medium`, `font-semibold`. |

**Mobile** (`apps/mobile/src/theme`): `const theme = useTheme()` for the nurse role, `useTheme('dark')` for the camera role. `theme.colors.inkMuted`, `theme.space.space4`, `theme.radius.radiusLg`, `theme.size.controlTouch`, `theme.shadow.shadowOverlay` (a `boxShadow` string, for sheets and the push banner only), and `theme.type.readoutXl` and the other type styles, which are spread into a `Text` style and already carry the right font file for their weight. The six static TTFs are in `apps/mobile/assets/fonts` and are embedded by the `expo-font` config plugin, so there is nothing to load at runtime. Screens take `Text` from `@/components/Text`, not from `react-native`: it follows the system text size up to 1.6 times (`MAX_TEXT_SCALE`), the point up to which every layout holds.

The design-system README's line "No surface shows a face or a video frame" is overridden in two places: the dashboard's live view, and the camera phone's viewfinder, which shows the live picture under the framing template and the outlines (section 3, Preview view). Neither stores video.

## 9. Ports and dev servers

| Who | Port | Command |
|---|---|---|
| Web QA | 3100 | `NEXT_DIST_DIR=.next-3100 PORT=3100 pnpm dev:web` |
| API | 3101 | `NEXT_DIST_DIR=.next-3101 PORT=3101 pnpm dev:web` |
| Dashboard | 3102 | `NEXT_DIST_DIR=.next-3102 PORT=3102 pnpm dev:web` |
| Mobile QA | 3200 | In the simulators: `apps/mobile/scripts/sim-qa.sh`, which starts this server itself on its own database `triagecam_simqa` (see `apps/mobile/sim-flows/README.md`). On a real phone: `NEXT_DIST_DIR=.next-3200 PORT=3200 pnpm dev:web`, then `ngrok http 3200` and put the https URL in `apps/mobile/.env.local` as `EXPO_PUBLIC_API_URL` |

- Always set `NEXT_DIST_DIR` with `PORT`: two dev servers sharing a dist dir corrupt each other. `apps/web/tsconfig.json` already lists these four dist dirs, so Next does not rewrite it. Delete your `.next-<port>` directory when you are done; disk space is short.
- `APP_URL` defaults to `http://localhost:3100`. Set it to your own origin when you test verification links.
- All dev servers share the one `triagecam` database unless `DATABASE_URL` says otherwise.
- `pnpm typecheck` (all packages), `pnpm test` (contracts tests and `swift test`), `swift build` and `swift test` in `packages/signal-engine`.
- Metro for the mobile app: 8081 by default; pass `--port` to `expo start` if another agent holds it.
- The simulators reach the Mac as `localhost`, so the rig needs no tunnel. It points the app at its server with `EXPO_PUBLIC_SIM_API_URL` in Metro's environment, which `apps/mobile/src/config.ts` reads before `EXPO_PUBLIC_API_URL`: in a development bundle Expo lets `.env.local` win over the shell, so the usual variable cannot be overridden for one run. `EXPO_PUBLIC_SIM_API_URL` never goes into an `.env` file.
