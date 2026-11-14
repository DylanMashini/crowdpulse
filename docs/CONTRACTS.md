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
- **Copy.** `PRIVACY_CAPTURE`, `PRIVACY_FACE` and `PROTOTYPE_NOTICE` in `@triagecam/contracts` are shown word for word. `PROTOTYPE_NOTICE` appears once per app, under the sign-in form, and nowhere else. The live view exists, so nothing may say "no video leaves the phone". The sentence is "Video is shown live to the operator and is not stored. Only numbers are saved."

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
| `startCapture(options?)` | `Promise<void>` | `{ camera?: 'back' \| 'front', frameRate?: 30 \| 60 }`, defaults back and 60. Starts the camera and face tracking; `onStatus` and `onFaceRegions` begin. Safe to call twice. |
| `stopCapture()` | `Promise<void>` | A running sitting is abandoned and its file deleted. |
| `startSitting({ sittingId })` | `Promise<{ sittingId, startedAt }>` | `sittingId` from `POST /api/sittings`. Creates the engine and the sitting file on the next frame; `onReading` begins. `startedAt` is the phone wall clock at the first frame. |
| `stopSitting()` | `Promise<SittingResult>` | `{ sittingId, endedAt, summary, fileUri }`. `summary` is `SignalEngine.finish()` unchanged and is the body of the finish request. `fileUri` is a `file://` URI, or null from the stub. The caller decides when 60 seconds are up. |
| `deleteSittingFile(fileUri)` | `Promise<void>` | After upload, or when the file is not wanted |
| `setLivePreview(options)` | `Promise<void>` | `{ enabled, fps?: 1 to 5 (default 2), maxLongSide?: up to 640 (default 480), quality?: 0 to 1 (default 0.5) }`. Off by default. Frames are never written to disk. |
| `captureFaceCrop()` | `Promise<{ jpegBase64, width, height }>` | The tracked face from the current frame, at most 512 px on the long side. Call it only for a ticket that opted in. |
| `addListener(name, listener)` | `{ remove() }` | |

Every promise rejects with an `Error` whose `code` is one of `ERR_CAMERA_PERMISSION`, `ERR_CAMERA_UNAVAILABLE`, `ERR_CAPTURE_INTERRUPTED`, `ERR_NOT_CAPTURING`, `ERR_SITTING_RUNNING`, `ERR_NO_SITTING`, `ERR_NO_FACE`, `ERR_FILE`.

### Events

Optional values cross the bridge as `null`, never as a missing key (the zod schemas on the server reject `undefined`).

| Event | Rate | Payload |
|---|---|---|
| `onReading` | Once per second during a sitting | `{ sittingId, reading }`. `reading` is the wire `Reading` (section 4), ready to post: `t` is the phone wall clock in ISO 8601 UTC (`startedAt + (engine t - captureStart)`), `elapsedMs` is `round(elapsed * 1000)`, `heartRate` and `breathingRate` are the engine's `Estimate`s with nil written as null. |
| `onStatus` | Once per second while capture runs | `{ source, fps, droppedFrames, exposureLocked, thermalState, facePresent, viewfinder, sittingId, sittingElapsedMs }`. `fps` is frames delivered in the last second. `droppedFrames` counts from the sitting's start, or from capture start when none is running. `thermalState` is `nominal`, `fair`, `serious` or `critical`. `viewfinder` is `searching`, `locking`, `measuring` or `lost`, the states of the design system's `Viewfinder`. |
| `onFaceRegions` | About 10 per second while capture runs | `{ aspectRatio, face, forehead, leftCheek, rightCheek, chest }`. `face` and `chest` are `{ x, y, width, height }`; the three skin regions are closed polygons of 4 to 12 `{ x, y }` points. All are null when not tracked. |
| `onPreviewFrame` | The rate set by `setLivePreview` | `{ jpegBase64, width, height, t }`: the wire `LiveFrame`. Post it to the live-view route as it is. |
| `onError` | When something fails outside a call | `{ code, message }` |

**Coordinates** are normalised to the camera frame as shown upright on screen: x to the right, y down, both 0 to 1, origin at the top-left corner. `aspectRatio` is that frame's width divided by its height. Only these outlines reach the viewfinder; it draws no picture.

### Simulated source

On the iOS simulator there is no camera, so the Swift module switches by itself (`#if targetEnvironment(simulator)`) to a simulated source: it generates frames with `SyntheticSitting` at the nominal rate in real time and feeds them through the same `SignalEngine`, sitting file writer and event path as camera frames. `getSource()` returns `'simulated'`, the sitting file header says `"source":"simulated"`, and the sitting is created on the server with `source: 'simulated'`.

- `onFaceRegions` reports fixed plausible outlines; `onStatus` reports the generator's frame rate with `exposureLocked` following the synthetic frames.
- `onPreviewFrame` and `captureFaceCrop()` return a generated flat or test-pattern JPEG, never a face. The server will answer `no_face_detected` to that crop, which is the expected result on the simulator.

## 4. HTTP API

All routes are under `/api` on the Next.js server. Bodies are JSON (`Content-Type: application/json`) unless a row says otherwise. Schemas are in `packages/contracts/src`; the name in the table is the exported schema and type. Conventions for errors, pagination, time and units are in section 5.

### Authentication

- **Web:** an httpOnly cookie named `tc_session` (`SESSION_COOKIE`), `SameSite=Lax`, `Path=/`, `Secure` when `APP_URL` is https, lifetime 7 days.
- **Mobile:** `Authorization: Bearer <token>`, lifetime 30 days. The app keeps the token in `expo-secure-store`.
- A request with both uses the bearer token. The token is 32 random bytes, base64url; the database stores only its SHA-256 (hex).
- Passwords: 8 characters or more and at most 72 bytes, hashed with bcrypt (cost 12).
- Email verification: the server emails `${APP_URL}/verify-email?token=<token>` through Resend. The token is 32 random bytes, stored as SHA-256, valid for 24 hours, single use. The dashboard page `/verify-email` posts the token to the verify route. **Without `RESEND_API_KEY` and outside production**, nothing is sent: the server logs the link and returns the raw token as `devVerificationToken`, so development and tests need no mailbox.
- Accounts are staff only. An unverified account cannot sign in.

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

### Tickets

A ticket is addressed by its public number everywhere: `/api/tickets/14`. No payload carries a ticket's database id.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/tickets` | staff | `CreateTicketRequest` `{ faceOptIn?: boolean }` (default false) | 201 `TicketResponse` `{ ticket }` |
| `GET /api/tickets` | staff | Query `TicketListQuery`: `status=waiting\|discharged\|all` (default `waiting`), `limit`, `cursor` | 200 `TicketListResponse` `{ items, nextCursor }`, newest first |
| `GET /api/tickets/:number` | staff | none | 200 `TicketDetailResponse` `{ ticket, state, baseline, sittings, flags, timeline, handoff }` |
| `PATCH /api/tickets/:number` | staff | `UpdateTicketRequest` `{ faceOptIn }` | 200 `TicketResponse`. Setting false deletes the stored embedding. 409 `ticket_discharged`. |
| `POST /api/tickets/:number/discharge` | staff | none | 200 `TicketResponse`. Sets status, closes open flags, deletes face embeddings. Calling it again returns the same ticket. |

`Ticket` is `{ number, status: 'waiting' \| 'discharged', createdAt, dischargedAt, faceOptIn, faceEnrolled }`.

In `TicketDetailResponse`: `state` is the tile state (null once discharged); `baseline` is the sitting trends are measured against; `sittings` are oldest first; `flags` newest first; `timeline` is newest first and each `TimelineEntry` has a `type` of `created`, `sitting`, `flag_opened`, `flag_acknowledged`, `flag_closed` or `discharged`, with `at` and the fields in `tickets.ts`; `handoff` is the templated sentence.

### Sittings

The order of calls for one sitting is in section 6.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/sittings` | staff | `StartSittingRequest` `{ ticketNumber, deviceId, kind: 'check_in' \| 'recheck', source, clientTime }` | 201 `StartSittingResponse` `{ sitting, serverTime }`. The server stores `clockOffsetMs = server now - clientTime`. 404 unknown ticket or device, 409 `ticket_discharged`. An unfinished sitting of the same ticket is ended without a summary first. |
| `POST /api/sittings/:id/readings` | staff | `PostReadingsRequest` `{ readings: Reading[] }`, 1 to 30 | 200 `PostReadingsResponse` `{ accepted }`. Once per second. A reading whose `t` is already stored is skipped, so a retry is safe. 409 `sitting_finished`. |
| `POST /api/sittings/:id/finish` | staff | `FinishSittingRequest` `{ endedAt, summary: SittingSummary }` | 200 `SittingResponse` `{ sitting }`. Stores the summary and beat intervals, then runs the trend rules. Calling it again returns the stored sitting. |
| `GET /api/sittings/:id` | staff | none | 200 `SittingDetailResponse` `{ sitting, readings, referenceReadings, beatIntervals, meanAbsoluteErrorBpm, pairedReadings, within5BpmShare }` |
| `PUT /api/sittings/:id/file` | staff | Body is the sitting file itself, `Content-Type: application/x-ndjson`, at most 5 MB | 204. Saved as `<SITTING_FILES_DIR>/<id>.jsonl`. Development and pilot only: 403 `forbidden` when `NODE_ENV` is production. 413 `payload_too_large`. |
| `POST /api/sittings/:id/reference` | staff | `PostReferenceRequest` `{ readings: ReferenceReading[] }`, 1 to 120 | 200 `PostReadingsResponse` `{ accepted }`. Allowed after the sitting is finished (a manual breath count arrives late). |

- `Reading` (phone to server): `{ t, elapsedMs, heartRate: Estimate, breathingRate: Estimate }`. `t` is the phone's wall clock; the server stores `t + clockOffsetMs`. `Estimate` is exactly the engine's (section 2), with `value` in bpm or breaths per minute.
- `StoredReading` (server to dashboard): `{ t, heartRate, breathingRate }` with `t` on the server clock.
- `Sitting`: `{ id, ticketNumber, deviceId, kind, source, startedAt, endedAt, clockOffsetMs, summary }`. `startedAt` and `endedAt` are on the server clock. `summary` is null until finished, then `{ durationSeconds, heartRate, breathingRate, rmssd, sdnn, timeToFirstReadingSeconds, longestDropoutSeconds, frameCount, droppedFrames }` where the four vitals are `{ value, coverage }`.
- `source` is `camera`, `simulated`, `stub` or `recording` (a replayed sitting file). Anything but `camera` is labelled on every screen that shows the sitting.
- `ReferenceReading`: `{ t, heartRate, rrIntervalsMs, breathingRate?, source: 'chest_strap' \| 'oximeter' \| 'manual' }`. `t` is the laptop's clock, which is the server clock. `rrIntervalsMs` is empty when the device reports none.
- In `SittingDetailResponse`, a **paired reading** is a valid heart-rate reading with a reference sample within 1.5 s of it; the three agreement fields are null or 0 when nothing pairs.

### Worklist

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/worklist` | staff | none | 200 `WorklistResponse` `{ generatedAt, recheckIntervalMin, items }` |

Every waiting ticket appears once, in rank order (`rank` 1 first). Clients do not sort. `WorklistItem`:

| Field | Meaning |
|---|---|
| `rank`, `ticketNumber` | |
| `state` | `observed`, `flag`, `overdue` or `no-reading`. Rules in section 6. |
| `waitingSince` | Ticket creation time |
| `lastObservedAt`, `minutesSinceObserved` | End of the last sitting that produced a valid heart or breathing rate; whole minutes since then at `generatedAt`. Both null if never observed. |
| `pulse`, `breathing` | `Trend` `{ base, now }`: the baseline sitting's value and the latest sitting's value, in bpm and breaths per minute. `now: null` means the latest sitting gave no reading for it. |
| `score`, `scoreAtCheckIn` | Partial NEWS2 band, 0 to 3: the higher of the two parameter bands. Null when nothing was measured. |
| `parametersMeasured` | 0, 1 or 2, for the "2 of 7 parameters" caption |
| `source` | Source of the latest sitting, or null |
| `flags` | Open `Flag`s, trend rules before overdue |
| `handoff` | The templated handoff sentence |
| `sittingInProgress` | A sitting is running for this ticket |

### Flags

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/flags` | staff | Query `FlagListQuery`: `status=open\|closed\|all` (default `open`), `ticket=<number>`, `limit`, `cursor` | 200 `FlagListResponse` `{ items, nextCursor }`, newest first |
| `POST /api/flags/:id/acknowledge` | staff | none | 200 `FlagResponse` `{ flag }`. Records who and when. Acknowledging twice changes nothing. Acknowledging does not close the flag. |

`Flag`: `{ id, ticketNumber, rule: 'score_rise' \| 'baseline_shift' \| 'overdue', openedAt, closedAt, detail, acknowledgedAt, acknowledgedBy, handoff }`. `detail` (`FlagDetail`) holds the numbers the flag was raised on: `{ pulse: Trend, breathing: Trend, scoreAtCheckIn, scoreNow, minutesSinceCheckIn, minutesSinceObserved }`. `acknowledgedBy` is the staff member's email (the first to acknowledge).

### Settings

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/settings` | staff | none | 200 `SettingsResponse` `{ settings, updatedAt }` |
| `PATCH /api/settings` | staff | `UpdateSettingsRequest`: any subset of `Settings` | 200 `SettingsResponse` |

| `Settings` field | Default | Range | Meaning |
|---|---|---|---|
| `recheckIntervalMin` | 30 | 1 to 240 | Minutes without a valid observation before a ticket is overdue |
| `pulseDeltaBpm` | 20 | 1 to 100 | Pulse movement from baseline that flags |
| `breathingDeltaPerMin` | 6 | 1 to 30 | Breathing movement from baseline that flags |
| `scoreRiseEnabled`, `baselineShiftEnabled`, `overdueEnabled` | true | | Turn each rule on or off |
| `notifyCooldownMin` | 10 | 0 to 240 | Minimum minutes between two pushes for one ticket |
| `faceMatchMinConfidence` | 0.8 | 0 to 1 | Below this, a face match asks for the ticket number |

### Statistics

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/statistics` | staff | Query `StatisticsQuery`: `from`, `to` (ISO 8601 UTC). Defaults: start of the server's local day, and now. | 200 `Statistics` |

| Field | Meaning |
|---|---|
| `totals` | `ticketsWaiting`, `ticketsDischarged`, `sittings`, `sittingsWithReference`, `openFlags`, `personHours` (sum over tickets of time spent waiting inside the range) |
| `heartRate` | `Agreement` over every paired reading in the range: `pairedReadings`, `meanAbsoluteErrorBpm`, `biasBpm` (mean of estimate minus reference), `within5BpmShare` |
| `sittings` | `attempted` (finished sittings), `withReading`, `accurateAcceptedShare` (of attempted sittings that have a reference, the share whose summary heart rate is within 5 bpm of the reference mean; no reading counts as a miss), `meanCoverage`, `medianTimeToFirstReadingSeconds`, `longestDropoutSeconds` |
| `flags` | `episodes` opened in the range, `episodesPerPersonHour`, `acknowledged`, `medianMinutesToAcknowledge` |
| `perTicket` | One `TicketStatistics` per ticket with a sitting in the range: the `Agreement` fields plus `ticketNumber`, `sittings`, `coverage` |

A share or mean with nothing under it is null, never 0. Sittings whose source is `stub` are left out of every number here.

### Face match

The embedding is computed and compared on the server. The phone sends one face crop, and only for a ticket whose `faceOptIn` is true. The crop is used in memory and not stored; the database keeps the embedding (`real[]`) and the model's name.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/tickets/:number/face` | staff | `EnrolFaceRequest` `{ jpegBase64 }` | 201 `EnrolFaceResponse` `{ ticketNumber, model }`. Replaces an earlier embedding for the ticket. 403 `face_not_opted_in`, 409 `ticket_discharged`, 422 `no_face_detected`. |
| `POST /api/face/match` | staff | `MatchFaceRequest` `{ jpegBase64 }` | 200 `MatchFaceResponse` `{ outcome, ticketNumber, confidence }`. 422 `no_face_detected`. |
| `DELETE /api/tickets/:number/face` | staff | none | 204, whether or not an embedding existed |

- `jpegBase64` has no `data:` prefix and is at most 400,000 characters.
- Matching compares against waiting, opted-in tickets only, and only embeddings from the same model.
- `outcome` is `matched` (`ticketNumber` set, `confidence` at or above `faceMatchMinConfidence`), `low_confidence` (someone resembles the crop but not surely; `ticketNumber` is null and the screen asks for the ticket number) or `no_match` (`confidence` null). A low-confidence guess is never disclosed.
- `confidence` is 0 to 1 for the best candidate. How cosine similarity maps onto it belongs to the face implementation and is stated beside the model.

### Live view

A camera-role phone whose operator turned the live view on posts low-rate JPEG frames. The server keeps only the newest frame per device, in memory, and relays it to dashboards that are watching. Nothing is written to disk or to the database. This works only with one server process, which is how the app runs.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/live/:deviceId/frame` | staff | `LiveFrame` `{ jpegBase64, width, height, t }` | 200 `PostLiveFrameResponse` `{ viewers }`. The device must be the caller's own camera device. With `viewers` 0 the phone may slow to 1 frame per second. |
| `GET /api/live/:deviceId/stream` | staff | none | 200 `multipart/x-mixed-replace; boundary=frame`: one `image/jpeg` part per frame, so `<img src>` shows it. Stays open; if the device has posted nothing in the last 5 seconds it sends nothing until a frame arrives. |

Limits (`LIVE_VIEW`): at most 5 frames per second, 640 px on the long side, JPEG quality 0.5; a device with no frame for 5 seconds is no longer live. `GET /api/devices` reports which camera devices are live through `liveAt`.

### Readings stream

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/stream` | staff | Optional query `ticket=<number>` to receive only that ticket's `reading` events | 200 `text/event-stream` |

Each event's `event:` field is the `type` and its `data:` is the whole `StreamEvent` object as JSON. A comment line (`: ping`) goes out every 15 seconds. `EventSource` reconnects by itself; on reconnect, refetch what the page shows, because events are not replayed.

| `type` | Payload | Sent when |
|---|---|---|
| `reading` | `{ sittingId, ticketNumber, reading: StoredReading }` | A reading is stored |
| `sitting_started` | `{ sitting }` | |
| `sitting_finished` | `{ sitting }` | |
| `flag_opened`, `flag_acknowledged`, `flag_closed` | `{ flag }` | |
| `worklist_changed` | `{ at }` | Ranks or states may differ: refetch `GET /api/worklist` |
| `ticket_changed` | `{ ticketNumber, at }` | A ticket was created, updated or discharged |
| `live_changed` | `{ deviceId, live }` | A camera device started or stopped posting frames |

The dashboard uses this stream. The nurse role of the mobile app polls `GET /api/worklist` every 5 seconds while it is on screen, and relies on push for the rest.

## 5. Conventions

### Errors

Every non-2xx response has this body (`ErrorResponse`), and nothing else:

```json
{ "error": { "code": "ticket_discharged", "message": "Ticket 14 has been discharged" } }
```

`message` is one plain sentence that is safe to show to staff. `details` is present for `invalid_request` and holds the zod issues. Codes and statuses (`ErrorCode`, `errorStatus`):

| Status | Codes |
|---|---|
| 400 | `invalid_request` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `email_not_verified`, `forbidden`, `face_not_opted_in` |
| 404 | `not_found` |
| 409 | `conflict`, `email_taken`, `ticket_discharged`, `sitting_finished` |
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
| RMSSD, SDNN, beat intervals | Milliseconds |
| Quality, coverage, confidence, shares | 0 to 1. Screens show a share as a percentage. |
| Region colour | Mean 8-bit channel value, 0 to 255 |
| Chest motion | Fraction of frame height per frame, positive downward |
| Outline coordinates | 0 to 1 of the upright frame, origin top-left |
| Ticket number | Positive integer, sequential, never reused |
| Ids (sitting, device, flag, user) | UUID strings |

## 6. Server behaviour both sides rely on

### One sitting, end to end

1. Operator creates a ticket (`POST /api/tickets`) or enters a number for a re-check, or the phone matches a face (`POST /api/face/match`).
2. Phone: `startCapture()`. The viewfinder draws `onFaceRegions`.
3. Phone: `POST /api/sittings` with `clientTime`, then `startSitting({ sittingId })`.
4. Every second: `onReading` gives a `Reading`; the phone posts it to `/api/sittings/:id/readings`. If a post fails, keep the reading and send it with the next one (up to 30 per request).
5. If the live view is on: `onPreviewFrame` frames are posted to `/api/live/:deviceId/frame`.
6. At 60 seconds (or when the operator stops): `stopSitting()`, then `POST /api/sittings/:id/finish` with `endedAt` and `summary`.
7. If the ticket opted in to face match and is not enrolled: `captureFaceCrop()` during the sitting, then `POST /api/tickets/:number/face`.
8. In development: `PUT /api/sittings/:id/file` with the file at `fileUri`, then `deleteSittingFile(fileUri)`.

The dashboard's check-in page follows the same sitting through `GET /api/stream` (`sitting_started`, `reading`, `sitting_finished`) and posts reference samples to `/api/sittings/:id/reference`.

### Observations, baseline and score

- An **observation** is a finished sitting whose summary has a heart rate or a breathing rate. A finished sitting with neither is a "no reading" attempt.
- The **baseline** is the ticket's first observation (normally the check-in sitting).
- **Parameter bands** (partial NEWS2): pulse 51 to 90 scores 0; 41 to 50 or 91 to 110 scores 1; 111 to 130 scores 2; 131 or above scores 3 (40 or below would score 3 but cannot be reported). Breathing 12 to 20 scores 0; 9 to 11 scores 1; 21 to 24 scores 2; 8 or below, or 25 or above, scores 3.
- A ticket's **score** is the higher of its measured parameter bands, 0 to 3. Bands are not summed.

### Flag rules

A flag is one episode: it opens once, may be acknowledged, and closes. At most one flag per ticket and rule is open at a time.

| Rule | Opens when | Closes when |
|---|---|---|
| `score_rise` | The two most recent observations both score higher than the baseline | An observation does not score higher than the baseline, or discharge |
| `baseline_shift` | On the two most recent observations, pulse differs from baseline by more than `pulseDeltaBpm` or breathing by more than `breathingDeltaPerMin` | An observation is within both thresholds, or discharge |
| `overdue` | No observation for longer than `recheckIntervalMin` (counted from ticket creation if there has been none) | An observation arrives, or discharge |

Trend rules run when a sitting is finished. Overdue is checked by the server on a timer of at most 30 seconds and whenever the worklist is computed.

### Tile state and rank

A waiting ticket's state is the first that applies:

1. `flag`: a `score_rise` or `baseline_shift` flag is open.
2. `no-reading`: the latest finished sitting was a "no reading" attempt.
3. `overdue`: an `overdue` flag is open.
4. `observed`: otherwise. A ticket with no sitting yet is `observed` with `lastObservedAt` and `minutesSinceObserved` null until it becomes overdue; screens say "Not yet observed" for it.

Rank order: all `flag` tickets first (higher `score` first, then the flag that opened earliest); then `overdue` and `no-reading` tickets together, longest time since the last observation first; then `observed` tickets, longest time since the last observation first.

### Handoff sentence and push

- The handoff sentence is built on the server from a fixed template and sent as a string; clients show it as it is. Example: "Ticket 14: pulse 82 at check-in, 108 now (26 min later); breathing 16 to 24. Last observed 3 min ago."
- When a flag opens, the server sends one push through Expo's push service to every `nurse` device that has a token, unless a push for the same ticket went out within `notifyCooldownMin`. Title: "Trend flag, ticket 14" (or "Overdue, ticket 14"). Body: the handoff sentence. `data`: `{ flagId, ticketNumber }`.
- The nurse role shows the same flag in the app whether or not the push arrives.

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
| `tickets` | `number` (identity, unique), `status`, `created_at`, `discharged_at`, `face_opt_in` |
| `sittings` | `ticket_id`, `device_id`, `kind`, `source`, `started_at`, `ended_at`, `clock_offset_ms`, and the summary: `duration_seconds`, `heart_rate`, `heart_rate_coverage`, `breathing_rate`, `breathing_rate_coverage`, `rmssd`, `rmssd_coverage`, `sdnn`, `sdnn_coverage`, `time_to_first_reading_seconds`, `longest_dropout_seconds`, `frame_count`, `dropped_frames` |
| `readings` | `sitting_id`, `ticket_id`, `t`, then the heart-rate estimate as `heart_rate`, `state`, `reason`, `quality`, `coverage`, `age_ms` and the breathing estimate as `breathing_rate`, `breathing_state`, `breathing_reason`, `breathing_quality`, `breathing_coverage`, `breathing_age_ms`. Unique on (`sitting_id`, `t`). |
| `beat_intervals` | One row per sitting: `intervals_ms real[]` and `beat_times_ms real[]`, parallel arrays |
| `reference_readings` | `sitting_id`, `t`, `heart_rate`, `rr_intervals_ms real[]`, `breathing_rate`, `source` |
| `flags` | `ticket_id`, `rule`, `opened_at`, `closed_at`, `detail jsonb` (`FlagDetail`), `last_notified_at`. One open flag per ticket and rule. |
| `acknowledgements` | `flag_id`, `user_id`, `at`. One per flag and user. |
| `face_embeddings` | `ticket_id`, `vector real[]` (L2-normalised), `model`, `created_at` |
| `settings` | Single row, `id` 1: the `Settings` fields and `updated_at` |

All times are `timestamptz` on the server clock. No table stores video, images or names.

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

**Mobile** (`apps/mobile/src/theme`): `const theme = useTheme()` for the nurse role, `useTheme('dark')` for the camera role. `theme.colors.inkMuted`, `theme.space.space4`, `theme.radius.radiusLg`, `theme.size.controlTouch`, `theme.shadow.shadowOverlay` (a `boxShadow` string, for sheets and the push banner only), and `theme.type.readoutXl` and the other type styles, which are spread into a `Text` style and already carry the right font file for their weight. The six static TTFs are in `apps/mobile/assets/fonts` and are embedded by the `expo-font` config plugin, so there is nothing to load at runtime.

The design-system README's line "No surface shows a face or a video frame" is overridden for one place only: the dashboard's live view. The camera phone's viewfinder still draws outlines, not the picture.

## 9. Ports and dev servers

| Who | Port | Command |
|---|---|---|
| Web QA | 3100 | `NEXT_DIST_DIR=.next-3100 PORT=3100 pnpm dev:web` |
| API | 3101 | `NEXT_DIST_DIR=.next-3101 PORT=3101 pnpm dev:web` |
| Dashboard | 3102 | `NEXT_DIST_DIR=.next-3102 PORT=3102 pnpm dev:web` |
| Mobile QA | 3200 | `NEXT_DIST_DIR=.next-3200 PORT=3200 pnpm dev:web`, then `ngrok http 3200` and put the https URL in `apps/mobile/.env.local` as `EXPO_PUBLIC_API_URL` |

- Always set `NEXT_DIST_DIR` with `PORT`: two dev servers sharing a dist dir corrupt each other. `apps/web/tsconfig.json` already lists these four dist dirs, so Next does not rewrite it. Delete your `.next-<port>` directory when you are done; disk space is short.
- `APP_URL` defaults to `http://localhost:3100`. Set it to your own origin when you test verification links.
- All dev servers share the one `triagecam` database unless `DATABASE_URL` says otherwise.
- `pnpm typecheck` (all packages), `pnpm test` (contracts tests and `swift test`), `swift build` and `swift test` in `packages/signal-engine`.
- Metro for the mobile app: 8081 by default; pass `--port` to `expo start` if another agent holds it.
