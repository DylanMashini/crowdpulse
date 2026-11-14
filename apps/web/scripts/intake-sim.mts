// Plays the part of a camera phone and a dashboard during one intake, against a running
// server, and measures how live it is. Run with `pnpm intake:sim` after `pnpm db:seed`.
//
//   SIM_URL       Server to test. Default http://localhost:3101.
//   SIM_EMAIL     Account to sign in with. Default the seeded demo account.
//   SIM_PASSWORD
//   SIM_SECONDS   How long the phone streams. Default 8.
//   SIM_FACE      Path to a picture with one face in it. With it, the frames show that face
//                 and the automatic profile photo is checked; without it, the frames are a
//                 test pattern and only the phone's own crop is stored.
//   SIM_KEEP=1    Leave the patient in the waiting room instead of discharging them.
//
// What the phone does here is what apps/mobile does: POST /api/patients, POST /api/sittings,
// then a raw JPEG to /api/live/:deviceId/frame fifteen times a second (two in flight at
// most, the rest dropped) and one reading a second. The dashboard side reads GET /api/stream
// and the multipart live stream, and types the intake form with PATCH /api/patients/:n.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DeviceResponse,
  LIVE_FRAME_HEADERS,
  LIVE_VIEW,
  PATIENT_PHOTO_SIZE,
  PatientDetailResponse,
  PatientResponse,
  SignInResponse,
  StartSittingResponse,
  StreamEvent,
  routes,
} from "@triagecam/contracts";
import sharp from "sharp";

const base = (process.env.SIM_URL || "http://localhost:3101").replace(/\/$/, "");
const email = process.env.SIM_EMAIL || "demo@triagecam.test";
const password = process.env.SIM_PASSWORD || "triagecam-demo";
const seconds = Number(process.env.SIM_SECONDS || 8);
const facePath = process.env.SIM_FACE || null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? Number.NaN;
};

async function json(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<unknown> {
  const response = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path} answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// --- sign in as the phone (bearer) and as the dashboard (cookie) --------------------------------

const phoneSession = SignInResponse.parse(await json("POST", routes.auth.signIn, {}, { email, password, client: "mobile" }));
const phone = { Authorization: `Bearer ${phoneSession.token}` };
const webSignIn = await fetch(base + routes.auth.signIn, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, client: "web" }),
});
assert.equal(webSignIn.status, 200, "the dashboard could not sign in: run pnpm db:seed first");
const web = { Cookie: (webSignIn.headers.get("set-cookie") ?? "").split(";")[0] as string };

const { device } = DeviceResponse.parse(
  await json("POST", routes.devices, phone, { role: "camera", label: "Simulated intake phone" }),
);

// --- the dashboard's event stream --------------------------------------------------------------

const events: { event: StreamEvent; at: number }[] = [];
const abort = new AbortController();
const sse = await fetch(base + routes.stream, { headers: web, signal: abort.signal });
void (async () => {
  let text = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of sse.body as ReadableStream<Uint8Array>) {
      text += decoder.decode(chunk, { stream: true });
      for (let end = text.indexOf("\n\n"); end !== -1; end = text.indexOf("\n\n")) {
        const data = text.slice(0, end).split("\n").find((line) => line.startsWith("data: "));
        text = text.slice(end + 2);
        if (data) events.push({ event: StreamEvent.parse(JSON.parse(data.slice(6))), at: performance.now() });
      }
    }
  } catch {
    // Aborted at the end of the run.
  }
})();

async function eventAfter(since: number, matches: (event: StreamEvent) => boolean, what: string, timeoutMs = 5000): Promise<number> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const found = events.find((entry) => entry.at >= since && matches(entry.event));
    if (found) return found.at - since;
    assert.ok(performance.now() < deadline, `the stream did not carry ${what} within ${timeoutMs} ms`);
    await sleep(5);
  }
}

// --- the frames the phone will send ------------------------------------------------------------

const WIDTH = LIVE_VIEW.maxLongSidePx;
const HEIGHT = 480;
/** A second of distinct frames, so the stream is not the same bytes over and over. */
async function makeFrames(): Promise<Buffer[]> {
  const background = facePath
    ? await sharp(await readFile(facePath)).resize(WIDTH, HEIGHT, { fit: "cover", position: "top" }).toBuffer()
    : await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 28, g: 40, b: 38 } } }).png().toBuffer();
  return Promise.all(
    Array.from({ length: LIVE_VIEW.fps }, (_, index) => {
      const x = Math.round((index / LIVE_VIEW.fps) * (WIDTH - 40));
      const marker = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><rect x="${x}" y="${HEIGHT - 14}" width="40" height="8" fill="#7fd1bd"/></svg>`;
      return sharp(background).composite([{ input: Buffer.from(marker) }]).jpeg({ quality: Math.round(LIVE_VIEW.jpegQuality * 100) }).toBuffer();
    }),
  );
}
const frames = await makeFrames();
const frameBytes = Math.round(frames.reduce((sum, frame) => sum + frame.byteLength, 0) / frames.length);

// --- intake starts on the phone -----------------------------------------------------------------

const createdAt = performance.now();
const { patient } = PatientResponse.parse(await json("POST", routes.patients, phone, {}));
const number = patient.number;
assert.equal(patient.name, null);
const createdLag = await eventAfter(createdAt, (event) => event.type === "patient_changed" && event.patientNumber === number, "the new patient");

const startedAt = performance.now();
const { sitting } = StartSittingResponse.parse(
  await json("POST", routes.sittings, phone, {
    patientNumber: number,
    deviceId: device.id,
    kind: "check_in",
    source: "simulated",
    clientTime: new Date().toISOString(),
  }),
);
const startedLag = await eventAfter(startedAt, (event) => event.type === "sitting_started" && event.sitting.id === sitting.id, "sitting_started");
console.log(`Patient ${number} created; the dashboard heard of them ${createdLag.toFixed(0)} ms later and of the sitting ${startedLag.toFixed(0)} ms later`);

// --- the dashboard watches the camera ---------------------------------------------------------

type Seen = { at: number; latencyMs: number | null; relayMs: number | null; sequence: number };
const seen: Seen[] = [];
const live = await fetch(base + routes.liveStream(device.id), { headers: web, signal: abort.signal });
assert.equal(live.status, 200);
void (async () => {
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of live.body as ReadableStream<Uint8Array>) {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const headerEnd = pending.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const headers = new Map(
          pending
            .subarray(0, headerEnd)
            .toString("latin1")
            .split("\r\n")
            .filter((line) => line.includes(":"))
            .map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()] as const),
        );
        const length = Number(headers.get("content-length"));
        if (!Number.isFinite(length)) {
          pending = pending.subarray(headerEnd + 4);
          continue;
        }
        if (pending.length < headerEnd + 4 + length) break;
        const now = Date.now();
        const captured = Number(headers.get(LIVE_FRAME_HEADERS.capturedAt));
        const received = Number(headers.get(LIVE_FRAME_HEADERS.receivedAt));
        seen.push({
          at: performance.now(),
          latencyMs: Number.isFinite(captured) ? now - captured : null,
          relayMs: Number.isFinite(received) ? now - received : null,
          sequence: Number(headers.get(LIVE_FRAME_HEADERS.sequence)),
        });
        pending = pending.subarray(headerEnd + 4 + length);
      }
    }
  } catch {
    // Aborted at the end of the run.
  }
})();

// --- the phone streams; staff type the form ------------------------------------------------------

let sent = 0;
let dropped = 0;
let refused = 0;
let inFlight = 0;
const streamStart = performance.now();
const ticker = setInterval(() => {
  if (inFlight >= 2) return void (dropped += 1);
  inFlight += 1;
  const frame = frames[sent % frames.length] as Buffer;
  sent += 1;
  fetch(base + routes.liveFrame(device.id), {
    method: "POST",
    headers: { ...phone, "Content-Type": "image/jpeg", [LIVE_FRAME_HEADERS.capturedAt]: String(Date.now()) },
    body: new Uint8Array(frame),
  })
    .then(async (response) => {
      if (!response.ok) refused += 1;
      await response.arrayBuffer();
    })
    .catch(() => (refused += 1))
    .finally(() => (inFlight -= 1));
}, 1000 / LIVE_VIEW.fps);

const none = { value: null, state: "settling", reason: "warming_up", quality: 0, coverage: 0, ageMs: null };
const readings = setInterval(() => {
  const elapsedMs = Math.round(performance.now() - streamStart);
  const heartRate = elapsedMs > 3000 ? { value: 74, state: "valid", reason: null, quality: 0.8, coverage: 0.6, ageMs: 0 } : none;
  void json("POST", routes.sittingReadings(sitting.id), phone, {
    readings: [{ t: new Date().toISOString(), elapsedMs, heartRate, breathingRate: none }],
  }).catch((error) => console.error(error));
}, 1000);

// Typing "Simone Rivera" with a save after each pause, the way the form does it.
const saveLags: number[] = [];
await sleep(800);
for (const name of ["Sim", "Simone", "Simone Riv", "Simone Rivera "]) {
  const sentAt = performance.now();
  const saved = PatientResponse.parse(await json("PATCH", routes.patient(number), web, { name })).patient;
  assert.equal(saved.name, name.trim());
  saveLags.push(await eventAfter(sentAt, (event) => event.type === "patient_changed" && event.patient.name === name.trim(), `the name "${name}"`));
  await sleep(350);
}
const intake = { reasonForVisit: "Chest tightness since this morning", dateOfBirth: "1984-07-22", sex: "female", painScore: 5, allergies: "", notes: "Walked in unaided." };
const filled = PatientResponse.parse(await json("PATCH", routes.patient(number), web, intake)).patient;
assert.equal(filled.reasonForVisit, intake.reasonForVisit);
assert.equal(filled.allergies, null, "an empty box is stored as null");
assert.equal(filled.painScore, 5);

await sleep(Math.max(0, seconds * 1000 - (performance.now() - streamStart)));
clearInterval(ticker);
clearInterval(readings);
await sleep(300);

// --- how live was it ---------------------------------------------------------------------------

const streamed = (performance.now() - streamStart) / 1000;
const steady = seen.filter((frame) => frame.at - streamStart > 1000);
const gaps = steady.slice(1).map((frame, index) => frame.at - (steady[index] as Seen).at);
const latencies = steady.flatMap((frame) => (frame.latencyMs === null ? [] : [frame.latencyMs]));
const relays = steady.flatMap((frame) => (frame.relayMs === null ? [] : [frame.relayMs]));
const fps = steady.length / ((steady.at(-1)?.at ?? 0) - (steady[0]?.at ?? 0)) * 1000;
console.log(
  [
    `Live view over ${streamed.toFixed(1)} s, ${WIDTH}x${HEIGHT} JPEG, ${(frameBytes / 1024).toFixed(1)} kB a frame:`,
    `  phone sent ${sent} frames (${dropped} skipped with two in flight, ${refused} refused)`,
    `  dashboard drew ${seen.length} frames: ${fps.toFixed(1)} fps, longest gap ${Math.max(...gaps).toFixed(0)} ms`,
    `  capture to dashboard: median ${percentile(latencies, 0.5)} ms, 95th percentile ${percentile(latencies, 0.95)} ms, worst ${Math.max(...latencies)} ms`,
    `  server to dashboard: median ${percentile(relays, 0.5)} ms, 95th percentile ${percentile(relays, 0.95)} ms`,
    `Intake form: a save reached the other dashboards in ${saveLags.map((lag) => lag.toFixed(0)).join(", ")} ms`,
  ].join("\n"),
);
assert.ok(fps >= 10, `the live view ran at ${fps.toFixed(1)} fps; it should hold 10 or more`);
assert.ok(percentile(latencies, 0.95) < 500, "the live view lagged by half a second or more");

// --- the profile photo ---------------------------------------------------------------------------

const photoHeaders = async (version: string) => {
  const response = await fetch(`${base}${routes.patientPhoto(number)}?v=${encodeURIComponent(version)}`, { headers: web });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.deepEqual([metadata.width, metadata.height], [PATIENT_PHOTO_SIZE, PATIENT_PHOTO_SIZE]);
  return response.headers.get("cache-control");
};
const current = async () => PatientDetailResponse.parse(await json("GET", routes.patient(number), web)).patient;
assert.equal((await fetch(base + routes.patientPhoto(number))).status, 401, "the photo needs a session");

if (facePath) {
  const auto = await current();
  assert.ok(auto.photoUpdatedAt, "the photo was not taken from the live view by itself");
  await photoHeaders(auto.photoUpdatedAt);
  const tookAfterMs = Date.parse(auto.photoUpdatedAt) - Date.parse(sitting.startedAt);
  console.log(`Profile photo: taken from the live view by itself ${(tookAfterMs / 1000).toFixed(1)} s into the sitting`);

  // Keep the camera live for the retake: one more frame.
  await fetch(base + routes.liveFrame(device.id), { method: "POST", headers: { ...phone, "Content-Type": "image/jpeg" }, body: new Uint8Array(frames[0] as Buffer) });
  const retaken = PatientResponse.parse(await json("POST", routes.patientPhotoCapture(number), web, { deviceId: device.id })).patient;
  assert.ok(retaken.photoUpdatedAt && retaken.photoUpdatedAt > auto.photoUpdatedAt, "the retake did not replace the photo");
  console.log("Profile photo: retaken from the frame on screen");
} else {
  assert.equal((await current()).photoUpdatedAt, null, "a test pattern has no face, so no photo may be taken from it");
  await fetch(base + routes.liveFrame(device.id), { method: "POST", headers: { ...phone, "Content-Type": "image/jpeg" }, body: new Uint8Array(frames[0] as Buffer) });
  const noFace = await fetch(base + routes.patientPhotoCapture(number), { method: "POST", headers: { ...web, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.id }) });
  assert.ok([422, 503].includes(noFace.status), `a frame with no face answered ${noFace.status}`);
  console.log(`Profile photo: none taken from a test pattern; "take photo now" answered ${noFace.status}`);
}

// The phone's own crop always replaces what is there.
const crop = await sharp({ create: { width: 300, height: 380, channels: 3, background: { r: 200, g: 160, b: 130 } } }).jpeg().toBuffer();
const put = PatientResponse.parse(await json("PUT", routes.patientPhoto(number), phone, { jpegBase64: crop.toString("base64") })).patient;
assert.ok(put.photoUpdatedAt);
assert.match((await photoHeaders(put.photoUpdatedAt)) ?? "", /immutable/);
await eventAfter(0, (event) => event.type === "patient_changed" && event.patient.photoUpdatedAt === put.photoUpdatedAt, "the new photo");
console.log(`Profile photo: the phone's crop was stored as ${PATIENT_PHOTO_SIZE}x${PATIENT_PHOTO_SIZE} and served with a session`);

// --- everything else sees the patient ----------------------------------------------------------

const worklist = (await json("GET", routes.worklist, web)) as { items: { patientNumber: number; patient: { name: string | null; photoUpdatedAt: string | null }; reasonForVisit: string | null; ageYears: number | null }[] };
const row = worklist.items.find((item) => item.patientNumber === number);
assert.equal(row?.patient.name, "Simone Rivera");
assert.equal(row?.patient.photoUpdatedAt, put.photoUpdatedAt);
assert.equal(row?.reasonForVisit, intake.reasonForVisit);
assert.ok((row?.ageYears ?? 0) >= 40);
console.log(`Worklist: ${row?.patient.name}, ${row?.ageYears} y, "${row?.reasonForVisit}"`);

await json("POST", routes.sittingFinish(sitting.id), phone, {
  endedAt: new Date().toISOString(),
  summary: {
    durationSeconds: streamed,
    frameCount: Math.round(streamed * 60),
    droppedFrames: 0,
    heartRate: { value: 74, coverage: 0.6 },
    breathingRate: { value: null, coverage: 0 },
    rmssd: { value: null, coverage: 0 },
    sdnn: { value: null, coverage: 0 },
    beatIntervals: [],
    timeToFirstReadingSeconds: 3,
    longestDropoutSeconds: 0,
  },
});
const detail = PatientDetailResponse.parse(await json("GET", routes.patient(number), web));
assert.match(detail.handoff, /^Simone Rivera: pulse 74 at check-in/);
console.log(`Handoff: ${detail.handoff}`);

if (process.env.SIM_KEEP !== "1") await json("POST", routes.patientDischarge(number), web);
abort.abort();
console.log(`\nIntake simulation passed against ${base}.`);
