// Raises a trend flag on the rig's server, so the nurse simulator has a banner to show without
// waiting for three one-minute sittings. It plays a camera phone over HTTP the way
// apps/web/scripts/smoke.mts does: a named patient, a check-in at 60 bpm, then re-checks whose
// one-second readings are compressed in time.
//
//   node scripts/sim-deteriorate.mjs            one deterioration that trips both trend rules:
//                                               one alert, one banner, one "to acknowledge"
//   node scripts/sim-deteriorate.mjs two        two deteriorations on later sittings: two alerts
//
//   SIM_URL       Server. Default http://localhost:3200, the rig's.
//   SIM_EMAIL     Account. Default the seeded demo account.
//   SIM_PASSWORD
//   SIM_NAME      Name given to the patient. Default "Sim Deteriorating".
//
// The sittings carry source "simulated". Run it only against the rig's own database.
// The paths are `routes` in @triagecam/contracts.

const base = (process.env.SIM_URL || 'http://localhost:3200').replace(/\/$/, '');
const email = process.env.SIM_EMAIL || 'demo@triagecam.test';
const password = process.env.SIM_PASSWORD || 'triagecam-demo';
const name = process.env.SIM_NAME || 'Sim Deteriorating';
const mode = process.argv[2] === 'two' ? 'two' : 'one';

let bearer = null;

async function call(method, path, body) {
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const valid = (value) => ({ value, state: 'valid', reason: null, quality: 0.8, coverage: 0.8, ageMs: 0 });
const settling = { value: null, state: 'settling', reason: 'warming_up', quality: 0, coverage: 0, ageMs: null };

function summary(heartRate, breathingRate) {
  return {
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
    heartRate: { value: heartRate, coverage: 0.87 },
    breathingRate: { value: breathingRate, coverage: 0.33 },
    rmssd: { value: 31.5, coverage: 0.8 },
    sdnn: { value: 44.2, coverage: 0.8 },
    beatIntervals: Array.from({ length: 40 }, (_, index) => ({ tMs: 9000 + index * 830, ms: 830 })),
    timeToFirstReadingSeconds: 9,
    longestDropoutSeconds: 1,
  };
}

/** One whole sitting: start, three readings, finish. */
async function sit(patientNumber, deviceId, kind, heartRate, breathingRate) {
  const startedAt = new Date();
  const { sitting } = await call('POST', '/api/sittings', {
    patientNumber,
    deviceId,
    kind,
    source: 'simulated',
    clientTime: startedAt.toISOString(),
  });
  const seconds = 3;
  for (let index = 0; index < seconds; index += 1) {
    const reading = {
      t: new Date(startedAt.getTime() + (index + 1) * 1000).toISOString(),
      elapsedMs: (index + 1) * 1000,
      heartRate: index === 0 ? settling : valid(heartRate),
      breathingRate: index === 0 ? settling : valid(breathingRate),
    };
    await call('POST', `/api/sittings/${sitting.id}/readings`, { readings: [reading] });
  }
  await call('POST', `/api/sittings/${sitting.id}/finish`, {
    endedAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
    summary: summary(heartRate, breathingRate),
  });
  console.log(`  ${kind} at ${heartRate} bpm, ${breathingRate} breaths per min`);
}

const signedIn = await call('POST', '/api/auth/sign-in', { email, password, client: 'mobile' });
bearer = signedIn.token;
const { device } = await call('POST', '/api/devices', { role: 'camera', label: 'Simulator rig, scripted camera' });
const { patient } = await call('POST', '/api/patients', {});
await call('PATCH', `/api/patients/${patient.number}`, { name, reasonForVisit: 'Scripted by the simulator rig' });
console.log(`Patient ${patient.number}, ${name}`);

await sit(patient.number, device.id, 'check_in', 60, 16);
if (mode === 'two') {
  // Moved from the baseline inside the same score band first, then into a higher band on later
  // sittings: two alerts, each with its own numbers.
  const { settings } = await call('GET', '/api/settings');
  const shifted = 60 + settings.pulseDeltaBpm + 4;
  if (shifted > 90) throw new Error(`The pulse threshold is ${settings.pulseDeltaBpm} bpm: too wide for two alerts`);
  await sit(patient.number, device.id, 'recheck', shifted, 16);
  await sit(patient.number, device.id, 'recheck', shifted, 16);
}
await sit(patient.number, device.id, 'recheck', 100, 16);
await sit(patient.number, device.id, 'recheck', 100, 16);

const flags = await call('GET', `/api/flags?patient=${patient.number}`);
const alerts = new Set(flags.items.map((flag) => flag.alertId));
console.log(`Open flags: ${flags.items.map((flag) => flag.rule).join(', ') || 'none'}; alerts: ${alerts.size}`);
const expected = mode === 'two' ? 2 : 1;
if (alerts.size !== expected) {
  console.error(`Expected ${expected} alert${expected === 1 ? '' : 's'}`);
  process.exit(1);
}
await call('POST', '/api/auth/sign-out');
