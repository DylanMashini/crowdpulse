// End-to-end smoke test of the API, over HTTP, against a running server. Every response is
// parsed with the zod schema the contract names, so a drifted shape fails here first.
//
//   pnpm smoke                                   against http://localhost:3101
//   SMOKE_URL=https://….ngrok-free.app pnpm smoke
//
// Optional environment:
//   SMOKE_SERVER_LOG   Path of the server's log. The verification link is then read from the
//                      log, as a person would; otherwise devVerificationToken is used.
//   SMOKE_PUSH_SINK    Port to listen on for pushes. Start the server with
//                      EXPO_PUSH_URL=http://localhost:<port>/push to check the push itself;
//                      without it no push token is registered and nothing leaves the machine.
//   SMOKE_FACE_SAME    Two JPEGs of one person, comma separated, and
//   SMOKE_FACE_OTHER   one JPEG of someone else, to check enrol and match with real faces.
//   SMOKE_OVERDUE=1    Also wait a minute for a ticket to go overdue. Changes the re-check
//                      interval while it runs, so use it on a database of your own.
//
// It creates one account, two devices and three tickets, and discharges the tickets it made.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import {
  DeviceListResponse,
  DeviceResponse,
  EnrolFaceResponse,
  ErrorResponse,
  FlagListResponse,
  FlagResponse,
  MatchFaceResponse,
  MeResponse,
  PostLiveFrameResponse,
  PostReadingsResponse,
  ResendVerificationResponse,
  routes,
  SESSION_COOKIE,
  SettingsResponse,
  SignInResponse,
  SignUpResponse,
  SittingDetailResponse,
  SittingResponse,
  StartSittingResponse,
  Statistics,
  StreamEvent,
  TicketDetailResponse,
  TicketListResponse,
  TicketResponse,
  VerifyEmailResponse,
  WorklistResponse,
} from "@triagecam/contracts";
import sharp from "sharp";
import type * as z from "zod";

const base = (process.env.SMOKE_URL || "http://localhost:3101").replace(/\/$/, "");
const pushSinkPort = process.env.SMOKE_PUSH_SINK ? Number(process.env.SMOKE_PUSH_SINK) : null;

type Auth = { cookie?: string; bearer?: string };
type Call = { auth?: Auth; body?: unknown; raw?: { body: Uint8Array<ArrayBuffer> | string; contentType: string } };

async function call(method: string, path: string, { auth, body, raw }: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "1" };
  if (auth?.cookie) headers.Cookie = auth.cookie;
  if (auth?.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = raw.contentType;
  return fetch(base + path, { method, headers, body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body) });
}

/** Expects `status` and a body that parses with `schema`. */
async function ok<Schema extends z.ZodType>(
  schema: Schema,
  status: number,
  method: string,
  path: string,
  options: Call = {},
): Promise<z.output<Schema>> {
  const response = await call(method, path, options);
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path} answered ${response.status}: ${text}`);
  return schema.parse(JSON.parse(text));
}

/** Expects the standard error body with this status and code. */
async function refused(status: number, code: string, method: string, path: string, options: Call = {}): Promise<void> {
  const response = await call(method, path, options);
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path} answered ${response.status}: ${text}`);
  const body = ErrorResponse.parse(JSON.parse(text));
  assert.equal(body.error.code, code, `${method} ${path}`);
  assert.ok(!/\bat .+:\d+:\d+/.test(text), "an error body must not carry a stack trace");
}

let step = 0;
const done = (what: string) => console.log(`${String((step += 1)).padStart(2)}. ${what}`);
const skipped: string[] = [];

async function until<T>(what: string, read: () => T | undefined | Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

// --- accounts ---------------------------------------------------------------------------

const email = `smoke-${Date.now()}@example.test`;
const password = "correct horse battery";

await refused(401, "unauthenticated", "GET", routes.worklist);
await refused(401, "unauthenticated", "GET", routes.stream);
await refused(401, "unauthenticated", "POST", routes.tickets, { body: {} });
await refused(401, "unauthenticated", "GET", routes.auth.me, { auth: { bearer: "not-a-token" } });
done("routes refuse a request with no session");

await refused(400, "invalid_request", "POST", routes.auth.signUp, { body: { email, password: "short" } });
await refused(400, "invalid_request", "POST", routes.auth.signUp, { body: { email: "nope", password } });
const signedUp = await ok(SignUpResponse, 201, "POST", routes.auth.signUp, { body: { email: email.toUpperCase(), password } });
assert.equal(signedUp.user.email, email);
assert.equal(signedUp.user.emailVerified, false);
const again = await ok(SignUpResponse, 201, "POST", routes.auth.signUp, { body: { email, password: "another password" } });
assert.deepEqual(Object.keys(again.user).sort(), Object.keys(signedUp.user).sort());
done("sign-up answers 201 with the same shape for a new and for a registered address");

await refused(403, "email_not_verified", "POST", routes.auth.signIn, { body: { email, password, client: "web" } });
await refused(401, "invalid_credentials", "POST", routes.auth.signIn, { body: { email, password: "wrong", client: "web" } });
await refused(401, "invalid_credentials", "POST", routes.auth.signIn, {
  body: { email: `nobody-${Date.now()}@example.test`, password, client: "web" },
});
done("sign-in is refused before verification and with wrong credentials");

const resent = await ok(ResendVerificationResponse, 200, "POST", routes.auth.resendVerification, { body: { email } });
await ok(ResendVerificationResponse, 200, "POST", routes.auth.resendVerification, {
  body: { email: `nobody-${Date.now()}@example.test` },
});

async function tokenFromLog(path: string): Promise<string> {
  return until("the verification link in the server log", async () => {
    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.includes(`Verification link for ${email}`));
    const link = lines.at(-1)?.match(/https?:\/\/\S+/)?.[0];
    return link ? (new URL(link).searchParams.get("token") ?? undefined) : undefined;
  });
}
const verificationToken = process.env.SMOKE_SERVER_LOG
  ? await tokenFromLog(process.env.SMOKE_SERVER_LOG)
  : resent.devVerificationToken;
assert.ok(verificationToken, "No verification token: the server has RESEND_API_KEY set, so use a real mailbox");
if (signedUp.devVerificationToken && again.devVerificationToken) {
  // Each new link replaces the one before it.
  await refused(410, "token_invalid", "POST", routes.auth.verifyEmail, { body: { token: signedUp.devVerificationToken } });
}
const verified = await ok(VerifyEmailResponse, 200, "POST", routes.auth.verifyEmail, { body: { token: verificationToken } });
assert.equal(verified.user.emailVerified, true);
await refused(410, "token_invalid", "POST", routes.auth.verifyEmail, { body: { token: verificationToken } });
done(`email verified with the link from ${process.env.SMOKE_SERVER_LOG ? "the server log" : "devVerificationToken"}; the link works once`);

const webSignIn = await call("POST", routes.auth.signIn, { body: { email, password, client: "web" } });
assert.equal(webSignIn.status, 200);
const webBody = SignInResponse.parse(await webSignIn.json());
assert.equal(webBody.token, undefined, "the web client must not receive the token in the body");
const setCookie = webSignIn.headers.get("set-cookie") ?? "";
assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /SameSite=Lax/i);
assert.match(setCookie, /Path=\//);
const web: Auth = { cookie: setCookie.split(";")[0] };
const webMe = await ok(MeResponse, 200, "GET", routes.auth.me, { auth: web });
assert.equal(webMe.session.kind, "web");

const mobileSignIn = await call("POST", routes.auth.signIn, { body: { email, password, client: "mobile" } });
const mobileBody = SignInResponse.parse(await mobileSignIn.json());
assert.ok(mobileBody.token, "the mobile client receives a bearer token");
assert.equal(mobileSignIn.headers.get("set-cookie"), null, "the mobile client gets no cookie");
const mobile: Auth = { bearer: mobileBody.token };
const mobileMe = await ok(MeResponse, 200, "GET", routes.auth.me, { auth: mobile });
assert.equal(mobileMe.session.kind, "mobile");
assert.ok(Date.parse(mobileMe.session.expiresAt) - Date.parse(webMe.session.expiresAt) > 20 * 86_400_000);
done("signed in both ways: httpOnly SameSite=Lax cookie for web, bearer token for mobile");

// --- devices, push sink, event stream -------------------------------------------------------

const pushes: { to: string; title: string; body: string; data: { flagId: string; ticketNumber: number } }[] = [];
const sink = pushSinkPort
  ? createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const messages = JSON.parse(text);
        pushes.push(...messages);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: messages.map(() => ({ status: "ok", id: "smoke" })) }));
      });
    }).listen(pushSinkPort)
  : null;

/** Pushes sent to this run's nurse device for one ticket. Other nurse devices in the database get them too. */
const pushesFor = (ticketNumber: number) =>
  pushes.filter((message) => message.to === pushToken && message.data.ticketNumber === ticketNumber);

const camera = (await ok(DeviceResponse, 200, "POST", routes.devices, { auth: mobile, body: { role: "camera", label: "Smoke camera" } })).device;
const pushToken = `ExponentPushToken[smoke-${Date.now()}]`;
const nurse = (
  await ok(DeviceResponse, 200, "POST", routes.devices, {
    auth: mobile,
    body: { role: "nurse", label: "Smoke nurse", ...(sink ? { expoPushToken: pushToken } : {}) },
  })
).device;
assert.equal(nurse.hasPushToken, sink !== null);
assert.ok(!JSON.stringify(nurse).includes(pushToken), "the push token is never returned");
const relabelled = await ok(DeviceResponse, 200, "POST", routes.devices, {
  auth: mobile,
  body: { id: camera.id, role: "camera", label: "Smoke camera (front desk)" },
});
assert.equal(relabelled.device.id, camera.id);
const listed = await ok(DeviceListResponse, 200, "GET", routes.devices, { auth: web });
assert.ok(listed.devices.some((device) => device.id === camera.id && device.label === "Smoke camera (front desk)"));
done("registered a camera device and a nurse device");

const events: StreamEvent[] = [];
const streamAbort = new AbortController();
const streamResponse = await fetch(base + routes.stream, { headers: { Cookie: web.cookie as string }, signal: streamAbort.signal });
assert.equal(streamResponse.status, 200);
assert.match(streamResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
void (async () => {
  let buffer = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of streamResponse.body as ReadableStream<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!type || !data) continue;
        const event = StreamEvent.parse(JSON.parse(data));
        assert.equal(event.type, type);
        events.push(event);
      }
    }
  } catch (error) {
    if (!streamAbort.signal.aborted) throw error;
  }
})();
const seen = <Type extends StreamEvent["type"]>(type: Type, matches: (event: Extract<StreamEvent, { type: Type }>) => boolean) =>
  until(`a ${type} event`, () =>
    events.find((event): event is Extract<StreamEvent, { type: Type }> => event.type === type && matches(event as never)),
  );

// --- one ticket: check-in, re-checks, flag ---------------------------------------------------

const ticket = (await ok(TicketResponse, 201, "POST", routes.tickets, { auth: mobile, body: { faceOptIn: true } })).ticket;
const number = ticket.number;
assert.equal(ticket.status, "waiting");
const second = (await ok(TicketResponse, 201, "POST", routes.tickets, { auth: web, body: {} })).ticket;
assert.equal(second.number, number + 1, "ticket numbers are sequential");
assert.equal(second.faceOptIn, false);
await seen("ticket_changed", (event) => event.ticketNumber === number);
await refused(404, "not_found", "GET", routes.ticket(99_999_999), { auth: web });
done(`created tickets ${number} and ${second.number}`);

/** The phone's clock runs two seconds behind the server in this test. */
const PHONE_SKEW_MS = -2000;
const phoneNow = () => new Date(Date.now() + PHONE_SKEW_MS);

const valid = (value: number) => ({ value, state: "valid", reason: null, quality: 0.8, coverage: 0.8, ageMs: 0 });
const settling = { value: null, state: "settling", reason: "warming_up", quality: 0, coverage: 0, ageMs: null };

function summary(heartRate: number | null, breathingRate: number | null) {
  return {
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 2,
    heartRate: { value: heartRate, coverage: heartRate === null ? 0 : 0.87 },
    breathingRate: { value: breathingRate, coverage: breathingRate === null ? 0 : 0.33 },
    rmssd: { value: heartRate === null ? null : 31.5, coverage: heartRate === null ? 0 : 0.8 },
    sdnn: { value: heartRate === null ? null : 44.2, coverage: heartRate === null ? 0 : 0.8 },
    beatIntervals: heartRate === null ? [] : Array.from({ length: 40 }, (_, index) => ({ tMs: 9000 + index * 830, ms: 830 })),
    timeToFirstReadingSeconds: heartRate === null ? null : 9,
    longestDropoutSeconds: heartRate === null ? 60 : 1,
  };
}

/** A whole sitting compressed in time: start, `seconds` readings one per request, finish. */
async function sit(ticketNumber: number, kind: "check_in" | "recheck", heartRate: number | null, breathingRate: number | null, seconds: number) {
  const startedOnPhone = phoneNow();
  const started = await ok(StartSittingResponse, 201, "POST", routes.sittings, {
    auth: mobile,
    body: { ticketNumber, deviceId: camera.id, kind, source: "simulated", clientTime: startedOnPhone.toISOString() },
  });
  const id = started.sitting.id;
  assert.ok(Math.abs(started.sitting.clockOffsetMs + PHONE_SKEW_MS) < 1500, "clockOffsetMs is server minus phone");
  const readings = Array.from({ length: seconds }, (_, index) => ({
    t: new Date(startedOnPhone.getTime() + (index + 1) * 1000).toISOString(),
    elapsedMs: (index + 1) * 1000,
    heartRate: heartRate !== null && index >= 8 ? valid(heartRate + (index % 3) - 1) : settling,
    breathingRate: breathingRate !== null && index >= 40 ? valid(breathingRate) : settling,
  }));
  for (const reading of readings) {
    const posted = await ok(PostReadingsResponse, 200, "POST", routes.sittingReadings(id), { auth: mobile, body: { readings: [reading] } });
    assert.equal(posted.accepted, 1);
  }
  const finish = () =>
    ok(SittingResponse, 200, "POST", routes.sittingFinish(id), {
      auth: mobile,
      body: { endedAt: new Date(startedOnPhone.getTime() + seconds * 1000).toISOString(), summary: summary(heartRate, breathingRate) },
    });
  return { id, started, readings, startedOnPhone, finish };
}

const worklistItem = async (ticketNumber: number) => {
  const worklist = await ok(WorklistResponse, 200, "GET", routes.worklist, { auth: mobile });
  assert.deepEqual(worklist.items.map((item) => item.rank), worklist.items.map((_, index) => index + 1));
  assert.equal(new Set(worklist.items.map((item) => item.ticketNumber)).size, worklist.items.length, "each ticket appears once");
  const item = worklist.items.find((candidate) => candidate.ticketNumber === ticketNumber);
  assert.ok(item, `ticket ${ticketNumber} is on the worklist`);
  return { item, worklist };
};
const openFlags = async (ticketNumber: number) =>
  (await ok(FlagListResponse, 200, "GET", `${routes.flags}?ticket=${ticketNumber}`, { auth: web })).items;

assert.equal((await worklistItem(number)).item.state, "observed");
assert.equal((await worklistItem(number)).item.lastObservedAt, null);

const checkIn = await sit(number, "check_in", 72, 16, 60);
assert.equal((await worklistItem(number)).item.sittingInProgress, true);
const retry = await ok(PostReadingsResponse, 200, "POST", routes.sittingReadings(checkIn.id), {
  auth: mobile,
  body: { readings: checkIn.readings.slice(57, 60) },
});
assert.equal(retry.accepted, 0, "a reading whose time is already stored is skipped");
await refused(400, "invalid_request", "POST", routes.sittingReadings(checkIn.id), {
  auth: mobile,
  body: { readings: Array.from({ length: 31 }, () => checkIn.readings[0]) },
});
await refused(400, "invalid_request", "POST", routes.sittingReadings(checkIn.id), {
  auth: mobile,
  body: { readings: [{ ...checkIn.readings[0], heartRate: { ...valid(72), value: null } }] },
});

// The reference strap is read by the dashboard, on the server clock.
const referenceStart = Date.parse(checkIn.started.sitting.startedAt);
const reference = await ok(PostReadingsResponse, 200, "POST", routes.sittingReference(checkIn.id), {
  auth: web,
  body: {
    readings: Array.from({ length: 60 }, (_, index) => ({
      t: new Date(referenceStart + (index + 1) * 1000 + 300).toISOString(),
      heartRate: 70,
      rrIntervalsMs: [857],
      source: "chest_strap",
    })),
  },
});
assert.equal(reference.accepted, 60);

const finished = (await checkIn.finish()).sitting;
assert.equal(finished.summary?.heartRate.value, 72);
assert.ok(finished.endedAt);
assert.deepEqual((await checkIn.finish()).sitting, finished, "finishing twice returns the stored sitting");
await refused(409, "sitting_finished", "POST", routes.sittingReadings(checkIn.id), {
  auth: mobile,
  body: { readings: [checkIn.readings[0]] },
});
done("ran a simulated check-in sitting: 60 readings, reference samples, finish with summary");

const header = { format: "triagecam.sitting", version: 1, sittingId: checkIn.id, source: "simulated", nominalFrameRate: 60, startedAt: checkIn.startedOnPhone.toISOString(), captureStart: 1000 };
const frame = { t: 1000, facePresent: false, exposure: "adjusting", droppedFrames: 0 };
const upload = await call("PUT", routes.sittingFile(checkIn.id), {
  auth: mobile,
  raw: { body: `${JSON.stringify(header)}\n${JSON.stringify(frame)}\n`, contentType: "application/x-ndjson" },
});
assert.equal(upload.status, 204, await upload.text());
await refused(400, "invalid_request", "PUT", routes.sittingFile(checkIn.id), {
  auth: mobile,
  raw: { body: "not a sitting file\n", contentType: "application/x-ndjson" },
});
await refused(413, "payload_too_large", "PUT", routes.sittingFile(checkIn.id), {
  auth: mobile,
  raw: { body: new Uint8Array(5 * 1024 * 1024 + 1).fill(0x20), contentType: "application/x-ndjson" },
});
done("uploaded the sitting file; a non-file and an oversized body are refused");

const detail = await ok(SittingDetailResponse, 200, "GET", routes.sitting(checkIn.id), { auth: web });
assert.equal(detail.readings.length, 60);
assert.equal(detail.referenceReadings.length, 60);
assert.equal(detail.beatIntervals.length, 40);
assert.equal(detail.pairedReadings, 52, "the 52 valid heart-rate readings each pair with a reference sample");
assert.ok(detail.meanAbsoluteErrorBpm !== null && detail.meanAbsoluteErrorBpm > 1 && detail.meanAbsoluteErrorBpm < 3);
assert.equal(detail.within5BpmShare, 1);
const storedSkew = Date.parse(detail.readings[0]?.t as string) - Date.parse(checkIn.readings[0]?.t as string);
assert.ok(Math.abs(storedSkew + PHONE_SKEW_MS) < 1500, "readings are stored on the server clock");
done(`sitting detail: ${detail.pairedReadings} paired readings, mean absolute error ${detail.meanAbsoluteErrorBpm.toFixed(2)} bpm`);

let { item } = await worklistItem(number);
assert.equal(item.state, "observed");
assert.deepEqual(item.pulse, { base: 72, now: 72 });
assert.equal(item.score, 0);
assert.equal(item.parametersMeasured, 2);
assert.equal(item.source, "simulated");
assert.equal(item.handoff, `Ticket ${number}: pulse 72, breathing 16 at check-in. Last observed 0 min ago.`);

await (await sit(number, "recheck", 104, 22, 3)).finish();
item = (await worklistItem(number)).item;
assert.equal(item.state, "observed", "one raised observation is not yet a flag");
assert.equal((await openFlags(number)).length, 0);

const tripping = await sit(number, "recheck", 108, 24, 3);
await tripping.finish();
const { item: flagged, worklist } = await worklistItem(number);
assert.equal(flagged.state, "flag");
assert.equal(flagged.score, 2);
assert.equal(flagged.scoreAtCheckIn, 0);
assert.deepEqual(flagged.pulse, { base: 72, now: 108 });
assert.deepEqual(flagged.breathing, { base: 16, now: 24 });
assert.deepEqual(flagged.flags.map((flag) => flag.rule), ["score_rise", "baseline_shift"]);
assert.match(
  flagged.handoff,
  new RegExp(`^Ticket ${number}: pulse 72 at check-in, 108 now \\(\\d+ min later\\); breathing 16 to 24\\. Last observed 0 min ago\\.$`),
);
const firstUnflagged = worklist.items.findIndex((candidate) => candidate.state !== "flag");
assert.ok(firstUnflagged === -1 || flagged.rank <= firstUnflagged, "flagged tickets lead the worklist");
const flags = await openFlags(number);
assert.equal(flags.length, 2, "one episode per rule");
const scoreRise = flags.find((flag) => flag.rule === "score_rise");
assert.ok(scoreRise);
assert.deepEqual(scoreRise.detail.pulse, { base: 72, now: 108 });
assert.equal(scoreRise.detail.scoreNow, 2);
assert.equal(scoreRise.handoff, flagged.handoff);
done(`the second raised re-check tripped the flag. ${flagged.handoff}`);

await seen("sitting_started", (event) => event.sitting.id === checkIn.id);
await seen("reading", (event) => event.sittingId === checkIn.id);
await seen("sitting_finished", (event) => event.sitting.id === tripping.id);
await seen("flag_opened", (event) => event.flag.id === scoreRise.id);
await seen("worklist_changed", () => true);
assert.equal(events.filter((event) => event.type === "reading" && event.sittingId === checkIn.id).length, 60);
done("the event stream carried sitting_started, 60 readings, sitting_finished, flag_opened and worklist_changed");

if (sink) {
  const push = await until("the push", () => pushesFor(number)[0]);
  assert.equal(push.title, `Trend flag, ticket ${number}`);
  assert.equal(push.body, flagged.handoff);
  await sleep(500);
  assert.equal(pushesFor(number).length, 1, "two flags, one push: the cool-down held");
  done(`one push reached the nurse device: "${push.title}"`);
} else {
  skipped.push("push delivery (set SMOKE_PUSH_SINK and the server's EXPO_PUSH_URL)");
}

const acknowledged = (await ok(FlagResponse, 200, "POST", routes.flagAcknowledge(scoreRise.id), { auth: mobile })).flag;
assert.equal(acknowledged.acknowledgedBy, email);
assert.ok(acknowledged.acknowledgedAt);
assert.equal(acknowledged.closedAt, null, "acknowledging does not close the flag");
const twice = (await ok(FlagResponse, 200, "POST", routes.flagAcknowledge(scoreRise.id), { auth: web })).flag;
assert.equal(twice.acknowledgedAt, acknowledged.acknowledgedAt);
await seen("flag_acknowledged", (event) => event.flag.id === scoreRise.id);
await refused(404, "not_found", "POST", routes.flagAcknowledge(camera.id), { auth: web });
done(`acknowledged by ${acknowledged.acknowledgedBy}`);

await (await sit(number, "recheck", 110, 24, 3)).finish();
assert.equal((await openFlags(number)).length, 2, "a third raised observation opens no new episode");
await (await sit(number, "recheck", null, null, 3)).finish();
item = (await worklistItem(number)).item;
assert.equal(item.state, "flag", "a no-reading sitting does not close a trend flag");
assert.deepEqual(item.pulse, { base: 72, now: null });
await (await sit(number, "recheck", 75, 16, 3)).finish();
item = (await worklistItem(number)).item;
assert.equal(item.state, "observed");
assert.equal((await openFlags(number)).length, 0);
const closed = (await ok(FlagListResponse, 200, "GET", `${routes.flags}?ticket=${number}&status=closed&limit=1`, { auth: web }));
assert.equal(closed.items.length, 1);
assert.ok(closed.nextCursor, "a second page of closed flags follows");
const nextPage = await ok(FlagListResponse, 200, "GET", `${routes.flags}?ticket=${number}&status=closed&limit=1&cursor=${closed.nextCursor}`, { auth: web });
assert.equal(nextPage.items.length, 1);
assert.notEqual(nextPage.items[0]?.id, closed.items[0]?.id);
assert.equal(nextPage.nextCursor, null);
await seen("flag_closed", (event) => event.flag.id === scoreRise.id);
if (sink) {
  assert.equal(pushesFor(number).length, 1, "still one push for the episode");
}
done("the flag stayed one episode while raised and closed when an observation came back to baseline");

await (await sit(second.number, "check_in", null, null, 3)).finish();
const noReading = (await worklistItem(second.number)).item;
assert.equal(noReading.state, "no-reading");
assert.equal(noReading.minutesSinceObserved, null);
assert.equal(noReading.score, null);
done(`a sitting with no signal put ticket ${second.number} in the no-reading state`);

const ticketView = await ok(TicketDetailResponse, 200, "GET", routes.ticket(number), { auth: web });
assert.equal(ticketView.sittings.length, 6);
assert.equal(ticketView.baseline?.id, checkIn.id);
assert.equal(ticketView.flags.length, 2);
assert.equal(ticketView.state, "observed");
for (const type of ["created", "sitting", "flag_opened", "flag_acknowledged", "flag_closed"]) {
  assert.ok(ticketView.timeline.some((entry) => entry.type === type), `the timeline has a ${type} entry`);
}
assert.deepEqual(ticketView.timeline.map((entry) => entry.at), ticketView.timeline.map((entry) => entry.at).sort().reverse());
done("ticket detail: baseline, sittings, flags and a newest-first timeline");

// --- settings and statistics --------------------------------------------------------------

const settings = await ok(SettingsResponse, 200, "GET", routes.settings, { auth: web });
await refused(400, "invalid_request", "PATCH", routes.settings, { auth: web, body: { recheckIntervalMin: 0 } });
const unchanged = await ok(SettingsResponse, 200, "PATCH", routes.settings, {
  auth: web,
  body: { pulseDeltaBpm: settings.settings.pulseDeltaBpm },
});
assert.deepEqual(unchanged.settings, settings.settings);

const stats = await ok(Statistics, 200, "GET", `${routes.statistics}?from=${new Date(Date.now() - 3_600_000).toISOString()}`, { auth: web });
assert.ok(stats.totals.sittings >= 7);
assert.ok(stats.totals.sittingsWithReference >= 1);
assert.ok(stats.heartRate.pairedReadings >= 52);
assert.ok(stats.heartRate.meanAbsoluteErrorBpm !== null && stats.heartRate.biasBpm !== null);
assert.ok(stats.sittings.attempted >= 7 && stats.sittings.withReading < stats.sittings.attempted);
assert.ok(stats.sittings.accurateAcceptedShare !== null);
assert.ok(stats.flags.episodes >= 2 && stats.flags.acknowledged >= 1);
assert.ok(stats.flags.episodesPerPersonHour !== null && stats.totals.personHours > 0);
const mine = stats.perTicket.find((row) => row.ticketNumber === number);
assert.equal(mine?.sittings, 6);
assert.equal(mine?.pairedReadings, 52);
assert.ok(stats.tileStates && stats.tileStates["no-reading"] >= 1);
const empty = await ok(Statistics, 200, "GET", `${routes.statistics}?from=2001-01-01T00:00:00.000Z&to=2001-01-02T00:00:00.000Z`, { auth: web });
assert.equal(empty.heartRate.meanAbsoluteErrorBpm, null);
assert.equal(empty.sittings.meanCoverage, null);
assert.equal(empty.flags.episodesPerPersonHour, null);
done(
  `statistics: ${stats.heartRate.pairedReadings} paired readings, MAE ${stats.heartRate.meanAbsoluteErrorBpm.toFixed(2)} bpm, bias ${stats.heartRate.biasBpm.toFixed(2)} bpm, ` +
    `${stats.flags.episodes} flag episodes over ${stats.totals.personHours.toFixed(2)} person-hours`,
);

// --- live view ------------------------------------------------------------------------------

const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer();
const liveFrame = { jpegBase64: jpeg.toString("base64"), width: 64, height: 48, t: phoneNow().toISOString() };

await refused(401, "unauthenticated", "GET", routes.liveStream(camera.id));
await refused(401, "unauthenticated", "POST", routes.liveFrame(camera.id), { body: liveFrame });
await refused(403, "forbidden", "POST", routes.liveFrame(nurse.id), { auth: mobile, body: liveFrame });
await refused(400, "invalid_request", "POST", routes.liveFrame(camera.id), {
  auth: mobile,
  body: { ...liveFrame, jpegBase64: Buffer.from("not a jpeg").toString("base64") },
});
await refused(400, "invalid_request", "POST", routes.liveFrame(camera.id), {
  auth: mobile,
  body: { ...liveFrame, jpegBase64: "A".repeat(400_001) },
});

const first = await ok(PostLiveFrameResponse, 200, "POST", routes.liveFrame(camera.id), { auth: mobile, body: liveFrame });
assert.equal(first.viewers, 0);
const liveAbort = new AbortController();
const live = await fetch(base + routes.liveStream(camera.id), { headers: { Cookie: web.cookie as string }, signal: liveAbort.signal });
assert.equal(live.headers.get("content-type"), "multipart/x-mixed-replace; boundary=frame");
let received = Buffer.alloc(0);
void (async () => {
  try {
    for await (const chunk of live.body as ReadableStream<Uint8Array>) received = Buffer.concat([received, chunk]);
  } catch (error) {
    if (!liveAbort.signal.aborted) throw error;
  }
})();
const count = () => received.toString("latin1").split("Content-Type: image/jpeg").length - 1;
await until("the frame held for a late viewer", () => (count() === 1 ? true : undefined));
await sleep(250);
const next = await ok(PostLiveFrameResponse, 200, "POST", routes.liveFrame(camera.id), { auth: mobile, body: liveFrame });
assert.equal(next.viewers, 1);
await until("the relayed frame", () => (count() === 2 ? true : undefined));
assert.ok(received.includes(jpeg), "the stream carries the JPEG bytes unchanged");
await refused(429, "rate_limited", "POST", routes.liveFrame(camera.id), { auth: mobile, body: liveFrame });
await seen("live_changed", (event) => event.deviceId === camera.id && event.live);
const liveNow = (await ok(DeviceListResponse, 200, "GET", routes.devices, { auth: web })).devices.find((device) => device.id === camera.id);
assert.ok(liveNow?.liveAt, "the camera device is reported live");
liveAbort.abort();
await seen("live_changed", (event) => event.deviceId === camera.id && !event.live).catch(() =>
  until("the device to stop being live", () => events.find((event) => event.type === "live_changed" && !event.live), 3000),
);
const liveLater = (await ok(DeviceListResponse, 200, "GET", routes.devices, { auth: web })).devices.find((device) => device.id === camera.id);
assert.equal(liveLater?.liveAt, null, "the frame is dropped after 5 seconds of silence");
done("live view: frame relayed to the dashboard as multipart JPEG, auth on both ends, dropped after 5 s of silence");

// --- face match -----------------------------------------------------------------------------

const flat = { jpegBase64: jpeg.toString("base64") };
const probe = await call("POST", routes.faceMatch, { auth: mobile, body: flat });
if (probe.status === 503) {
  assert.equal(ErrorResponse.parse(await probe.json()).error.code, "face_unavailable");
  skipped.push("face match (models not installed: run `pnpm face:models`)");
} else {
  assert.equal(probe.status, 422, await probe.clone().text());
  assert.equal(ErrorResponse.parse(await probe.json()).error.code, "no_face_detected");
  await refused(422, "no_face_detected", "POST", routes.ticketFace(number), { auth: mobile, body: flat });
  await refused(403, "face_not_opted_in", "POST", routes.ticketFace(second.number), { auth: mobile, body: flat });
  await refused(400, "invalid_request", "POST", routes.faceMatch, { auth: mobile, body: { jpegBase64: "AAAA" } });
  done("face match answers no_face_detected for a picture with no face, and refuses a ticket that did not opt in");

  const same = (process.env.SMOKE_FACE_SAME ?? "").split(",").filter(Boolean);
  const other = process.env.SMOKE_FACE_OTHER;
  if (same.length === 2 && other) {
    const crop = async (path: string) => ({ jpegBase64: (await readFile(path)).toString("base64") });
    const enrolled = await ok(EnrolFaceResponse, 201, "POST", routes.ticketFace(number), { auth: mobile, body: await crop(same[0] as string) });
    assert.equal(enrolled.ticketNumber, number);
    assert.equal((await ok(TicketResponse, 200, "PATCH", routes.ticket(number), { auth: web, body: { faceOptIn: true } })).ticket.faceEnrolled, true);
    const match = await ok(MatchFaceResponse, 200, "POST", routes.faceMatch, { auth: mobile, body: await crop(same[1] as string) });
    assert.equal(match.outcome, "matched", `a second picture of the same person: ${JSON.stringify(match)}`);
    assert.equal(match.ticketNumber, number);
    const stranger = await ok(MatchFaceResponse, 200, "POST", routes.faceMatch, { auth: mobile, body: await crop(other) });
    assert.notEqual(stranger.outcome, "matched", `someone else: ${JSON.stringify(stranger)}`);
    assert.equal(stranger.ticketNumber, null, "a guess below the threshold is never named");
    const removed = await call("DELETE", routes.ticketFace(number), { auth: mobile });
    assert.equal(removed.status, 204);
    const after = await ok(MatchFaceResponse, 200, "POST", routes.faceMatch, { auth: mobile, body: await crop(same[1] as string) });
    assert.notEqual(after.ticketNumber, number, "a deleted embedding no longer matches");
    await ok(EnrolFaceResponse, 201, "POST", routes.ticketFace(number), { auth: mobile, body: await crop(same[0] as string) });
    done(`face enrolled with ${enrolled.model}; same person matched at confidence ${match.confidence?.toFixed(2)}, someone else was ${stranger.outcome} (${stranger.confidence?.toFixed(2) ?? "no confidence"})`);
  } else {
    skipped.push("face enrol and match with real faces (set SMOKE_FACE_SAME and SMOKE_FACE_OTHER)");
  }
}

// --- overdue (optional), discharge, sign out ------------------------------------------------------

if (process.env.SMOKE_OVERDUE === "1") {
  const waiting = (await ok(TicketResponse, 201, "POST", routes.tickets, { auth: web, body: {} })).ticket;
  await ok(SettingsResponse, 200, "PATCH", routes.settings, { auth: web, body: { recheckIntervalMin: 1 } });
  try {
    const overdue = await until(
      `ticket ${waiting.number} to go overdue`,
      async () => {
        const found = (await worklistItem(waiting.number)).item;
        return found.state === "overdue" ? found : undefined;
      },
      75_000,
    );
    assert.deepEqual(overdue.flags.map((flag) => flag.rule), ["overdue"]);
    assert.equal(overdue.handoff, `Ticket ${waiting.number}: not yet observed, waiting 1 min.`);
    const firstObserved = (await worklistItem(waiting.number)).worklist.items.findIndex((candidate) => candidate.state === "observed");
    assert.ok(firstObserved === -1 || overdue.rank <= firstObserved, "overdue ranks above observed tickets");
    if (sink) {
      const push = await until("the overdue push", () => pushesFor(waiting.number)[0]);
      assert.equal(push.title, `Overdue, ticket ${waiting.number}`);
    }
    await (await sit(waiting.number, "check_in", 70, 15, 3)).finish();
    assert.equal((await worklistItem(waiting.number)).item.state, "observed", "an observation closes the overdue flag");
    done(`ticket ${waiting.number} went overdue after the re-check interval and cleared on an observation`);
  } finally {
    await ok(SettingsResponse, 200, "PATCH", routes.settings, { auth: web, body: { recheckIntervalMin: settings.settings.recheckIntervalMin } });
    await ok(TicketResponse, 200, "POST", routes.ticketDischarge(waiting.number), { auth: web });
  }
} else {
  skipped.push("waiting for a ticket to go overdue (SMOKE_OVERDUE=1, on your own database)");
}

const tickets = await ok(TicketListResponse, 200, "GET", `${routes.tickets}?limit=1`, { auth: web });
assert.equal(tickets.items.length, 1);
const discharged = (await ok(TicketResponse, 200, "POST", routes.ticketDischarge(number), { auth: web })).ticket;
assert.equal(discharged.status, "discharged");
assert.equal(discharged.faceEnrolled, false, "discharge deletes the face embedding");
assert.deepEqual((await ok(TicketResponse, 200, "POST", routes.ticketDischarge(number), { auth: web })).ticket, discharged);
await refused(409, "ticket_discharged", "POST", routes.sittings, {
  auth: mobile,
  body: { ticketNumber: number, deviceId: camera.id, kind: "recheck", source: "simulated", clientTime: phoneNow().toISOString() },
});
await refused(409, "ticket_discharged", "PATCH", routes.ticket(number), { auth: web, body: { faceOptIn: false } });
await refused(409, "ticket_discharged", "POST", routes.ticketFace(number), { auth: mobile, body: flat });
const after = await ok(WorklistResponse, 200, "GET", routes.worklist, { auth: web });
assert.ok(!after.items.some((candidate) => candidate.ticketNumber === number), "a discharged ticket leaves the worklist");
assert.equal((await ok(TicketDetailResponse, 200, "GET", routes.ticket(number), { auth: web })).state, null);
await ok(TicketResponse, 200, "POST", routes.ticketDischarge(second.number), { auth: web });
done("discharge closed the ticket, deleted its face embedding and took it off the worklist");

if (sink) {
  // Leave no push token behind for later runs to send to.
  const cleared = await ok(DeviceResponse, 200, "POST", routes.devices, {
    auth: mobile,
    body: { id: nurse.id, role: "nurse", label: "Smoke nurse", expoPushToken: null },
  });
  assert.equal(cleared.device.hasPushToken, false);
}
streamAbort.abort();
const signedOut = await call("POST", routes.auth.signOut, { auth: web });
assert.equal(signedOut.status, 204);
assert.match(signedOut.headers.get("set-cookie") ?? "", new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
await refused(401, "unauthenticated", "GET", routes.auth.me, { auth: web });
assert.equal((await call("POST", routes.auth.signOut, { auth: mobile })).status, 204);
await refused(401, "unauthenticated", "GET", routes.auth.me, { auth: mobile });
done("signed out of both sessions");

sink?.close();
console.log(`\nSmoke test passed against ${base}.`);
for (const what of skipped) console.log(`Not checked: ${what}.`);
