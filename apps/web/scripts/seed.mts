// Creates a verified demo staff account, two devices and a waiting room with one patient in
// each state, so the dashboard and the nurse role have something to show. Rows are written
// straight to the database because their times are in the past; the flags are then opened
// by the same trend rules the server runs. Run with `pnpm db:seed`.
//
// The demo patients are added only to an empty waiting room. Pass --more to add another set.
import { PATIENT_PHOTO_SIZE } from "@triagecam/contracts";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "../src/db/client.ts";
import { hashPassword } from "../src/server/auth/passwords.ts";
import { syncPatients } from "../src/server/trend/engine.ts";

const email = (process.env.SEED_EMAIL || "demo@triagecam.test").toLowerCase();
const password = process.env.SEED_PASSWORD || "triagecam-demo";

const MINUTE_MS = 60_000;
const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * MINUTE_MS);

/** Small deterministic generator, so every seed run writes the same numbers. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type SittingPlan = {
  /** Minutes before now that the sitting ended. */
  endedMinutesAgo: number;
  /** Null is a sitting that gave no reading. */
  heartRate: number | null;
  breathingRate: number | null;
  /** Also store chest-strap samples, so the statistics have agreement to report. */
  withReference?: boolean;
};

type Intake = Pick<
  typeof schema.patients.$inferInsert,
  "name" | "dateOfBirth" | "sex" | "reasonForVisit" | "painScore" | "allergies" | "notes"
>;

type PatientPlan = {
  note: string;
  /** What staff typed at check-in. Left out for a patient whose intake has not been filled in. */
  intake?: Intake;
  /** Colours of the drawn stand-in portrait. Left out: no photo, so the initials show. */
  portrait?: { background: string; skin: string; hair: string; top: string };
  createdMinutesAgo: number;
  dischargedMinutesAgo?: number;
  sittings: SittingPlan[];
  /** Minutes before now at which the server would have run its rules and opened the flags. */
  flagsOpenedMinutesAgo?: number;
};

const PLANS: PatientPlan[] = [
  {
    note: "steady, observed",
    intake: {
      name: "Maya Chen",
      dateOfBirth: "1991-04-18",
      sex: "female",
      reasonForVisit: "Twisted ankle on the stairs, swelling",
      painScore: 4,
      allergies: "Penicillin",
      notes: "Can bear some weight. Ice applied at home.",
    },
    portrait: { background: "#dfe9e4", skin: "#e8b995", hair: "#2b2320", top: "#3f6f66" },
    createdMinutesAgo: 52,
    sittings: [
      { endedMinutesAgo: 50, heartRate: 74, breathingRate: 15, withReference: true },
      { endedMinutesAgo: 22, heartRate: 76, breathingRate: 16, withReference: true },
    ],
  },
  {
    note: "trend flag: pulse and breathing up on two consecutive observations",
    intake: {
      name: "Robert Okafor",
      dateOfBirth: "1958-09-02",
      sex: "male",
      reasonForVisit: "Short of breath since this morning",
      painScore: 2,
      allergies: null,
      notes: "History of COPD. Uses a salbutamol inhaler, last dose two hours ago.",
    },
    portrait: { background: "#e6e2d8", skin: "#8a5a3c", hair: "#b9b6b0", top: "#4b5563" },
    createdMinutesAgo: 31,
    sittings: [
      { endedMinutesAgo: 29, heartRate: 82, breathingRate: 16, withReference: true },
      { endedMinutesAgo: 9, heartRate: 104, breathingRate: 22, withReference: true },
      { endedMinutesAgo: 3, heartRate: 108, breathingRate: 24, withReference: true },
    ],
    flagsOpenedMinutesAgo: 3,
  },
  {
    note: "overdue: nothing since check-in",
    intake: {
      name: "Priya Raman",
      dateOfBirth: "2003-12-11",
      sex: "female",
      reasonForVisit: "Migraine, nausea",
      painScore: 7,
      allergies: null,
      notes: "Light sensitive. Took ibuprofen 400 mg at home.",
    },
    portrait: { background: "#e3e1ec", skin: "#c68e68", hair: "#1c1a22", top: "#7a5c8e" },
    createdMinutesAgo: 49,
    sittings: [{ endedMinutesAgo: 47, heartRate: 68, breathingRate: 14 }],
    flagsOpenedMinutesAgo: 16,
  },
  {
    note: "no reading: the re-check gave no signal",
    intake: {
      name: "Daniel Whitfield",
      dateOfBirth: "1979-06-27",
      sex: "male",
      reasonForVisit: "Cut to the left hand, bleeding controlled",
      painScore: 3,
      allergies: "Latex",
      notes: null,
    },
    createdMinutesAgo: 27,
    sittings: [
      { endedMinutesAgo: 25, heartRate: 88, breathingRate: 18, withReference: true },
      { endedMinutesAgo: 4, heartRate: null, breathingRate: null },
    ],
  },
  { note: "just arrived, not yet observed", createdMinutesAgo: 2, sittings: [] },
  {
    note: "discharged",
    intake: {
      name: "Elena Sokolova",
      dateOfBirth: "1986-01-30",
      sex: "female",
      reasonForVisit: "Sore throat for three days",
      painScore: 2,
      allergies: null,
      notes: null,
    },
    portrait: { background: "#e9e3da", skin: "#f0c8a8", hair: "#a8672f", top: "#a65d4a" },
    createdMinutesAgo: 95,
    dischargedMinutesAgo: 40,
    sittings: [{ endedMinutesAgo: 92, heartRate: 71, breathingRate: 13 }],
  },
];

const SITTING_SECONDS = 60;
const FIRST_HEART_RATE_SECOND = 9;
const FIRST_BREATHING_SECOND = 41;

async function ensureAccount(): Promise<string> {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash, emailVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: schema.users.email, set: { passwordHash, emailVerifiedAt: new Date() } })
    .returning();
  if (!user) throw new Error("The demo account was not created");
  return user.id;
}

async function ensureDevice(userId: string, role: "camera" | "nurse", label: string): Promise<string> {
  const existing = await db.select().from(schema.devices).where(eq(schema.devices.userId, userId));
  const found = existing.find((device) => device.role === role && device.label === label);
  if (found) return found.id;
  const [created] = await db.insert(schema.devices).values({ userId, role, label }).returning();
  if (!created) throw new Error("The demo device was not created");
  return created.id;
}

async function addSitting(patientId: string, deviceId: string, plan: SittingPlan, isFirst: boolean, seed: number) {
  const next = random(seed);
  const jitter = (spread: number) => (next() - 0.5) * 2 * spread;
  const endedAt = minutesAgo(plan.endedMinutesAgo);
  const startedAt = new Date(endedAt.getTime() - SITTING_SECONDS * 1000);
  const heartSeconds = plan.heartRate === null ? 0 : SITTING_SECONDS - FIRST_HEART_RATE_SECOND + 1;
  const breathingSeconds = plan.breathingRate === null ? 0 : SITTING_SECONDS - FIRST_BREATHING_SECOND + 1;

  const [sitting] = await db
    .insert(schema.sittings)
    .values({
      patientId,
      deviceId,
      kind: isFirst ? "check_in" : "recheck",
      source: "simulated",
      startedAt,
      endedAt,
      durationSeconds: SITTING_SECONDS,
      heartRate: plan.heartRate,
      heartRateCoverage: heartSeconds / SITTING_SECONDS,
      breathingRate: plan.breathingRate,
      breathingRateCoverage: breathingSeconds / SITTING_SECONDS,
      rmssd: plan.heartRate === null ? null : 34 + jitter(8),
      rmssdCoverage: plan.heartRate === null ? 0 : 0.8,
      sdnn: plan.heartRate === null ? null : 48 + jitter(10),
      sdnnCoverage: plan.heartRate === null ? 0 : 0.8,
      timeToFirstReadingSeconds: plan.heartRate === null ? null : FIRST_HEART_RATE_SECOND,
      longestDropoutSeconds: plan.heartRate === null ? SITTING_SECONDS : 0,
      frameCount: SITTING_SECONDS * 60,
      droppedFrames: Math.round(next() * 4),
    })
    .returning();
  if (!sitting) throw new Error("The demo sitting was not created");

  const readings = Array.from({ length: SITTING_SECONDS }, (_, index) => {
    const second = index + 1;
    const heartValid = plan.heartRate !== null && second >= FIRST_HEART_RATE_SECOND;
    const breathingValid = plan.breathingRate !== null && second >= FIRST_BREATHING_SECOND;
    const settling = second < FIRST_HEART_RATE_SECOND;
    return {
      sittingId: sitting.id,
      patientId,
      t: new Date(startedAt.getTime() + second * 1000),
      heartRate: heartValid ? (plan.heartRate as number) + jitter(1.5) : null,
      state: heartValid ? ("valid" as const) : settling ? ("settling" as const) : ("none" as const),
      reason: heartValid ? null : settling ? (second < 5 ? "warming_up" : "awaiting_agreement") : "low_quality",
      quality: heartValid ? 0.75 + jitter(0.1) : 0.2 + jitter(0.1),
      coverage: heartValid ? (second - FIRST_HEART_RATE_SECOND + 1) / second : 0,
      ageMs: heartValid ? 0 : null,
      breathingRate: breathingValid ? (plan.breathingRate as number) + jitter(0.6) : null,
      breathingState: breathingValid
        ? ("valid" as const)
        : second < FIRST_BREATHING_SECOND
          ? ("settling" as const)
          : ("none" as const),
      breathingReason: breathingValid ? null : second < FIRST_BREATHING_SECOND ? "warming_up" : "low_quality",
      breathingQuality: breathingValid ? 0.7 + jitter(0.1) : 0.2 + jitter(0.1),
      breathingCoverage: breathingValid ? (second - FIRST_BREATHING_SECOND + 1) / second : 0,
      breathingAgeMs: breathingValid ? 0 : null,
    };
  });
  await db.insert(schema.readings).values(readings);

  if (plan.heartRate !== null) {
    const beatMs = 60_000 / plan.heartRate;
    const intervals = Array.from({ length: Math.floor((50 * 1000) / beatMs) }, () => beatMs + jitter(30));
    let elapsed = FIRST_HEART_RATE_SECOND * 1000;
    await db.insert(schema.beatIntervals).values({
      sittingId: sitting.id,
      intervalsMs: intervals,
      beatTimesMs: intervals.map((interval) => (elapsed += interval)),
    });
  }

  if (plan.withReference && plan.heartRate !== null) {
    const reference = plan.heartRate + jitter(2);
    await db.insert(schema.referenceReadings).values(
      Array.from({ length: SITTING_SECONDS }, (_, index) => ({
        sittingId: sitting.id,
        t: new Date(startedAt.getTime() + (index + 1) * 1000 + 200),
        heartRate: Math.round(reference + jitter(1)),
        rrIntervalsMs: [60_000 / reference + jitter(25)],
        source: "chest_strap" as const,
      })),
    );
  }
}

/**
 * A drawn stand-in for the intake photo, so the seeded dashboard shows faces without a real
 * person's picture being in the repository. A real photo comes from the camera at check-in.
 */
function drawnPortrait({ background, skin, hair, top }: NonNullable<PatientPlan["portrait"]>): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="0 0 384 384">
    <rect width="384" height="384" fill="${background}"/>
    <path d="M52 384c0-84 62-128 140-128s140 44 140 128z" fill="${top}"/>
    <rect x="166" y="212" width="52" height="64" rx="22" fill="${skin}"/>
    <ellipse cx="192" cy="150" rx="84" ry="92" fill="${hair}"/>
    <ellipse cx="192" cy="164" rx="66" ry="78" fill="${skin}"/>
    <path d="M124 150c4-52 36-76 68-76s64 24 68 76c-20-22-42-34-68-34s-48 12-68 34z" fill="${hair}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(PATIENT_PHOTO_SIZE, PATIENT_PHOTO_SIZE).jpeg({ quality: 86 }).toBuffer();
}

async function addPatient(plan: PatientPlan, cameraId: string, index: number): Promise<string> {
  const discharged = plan.dischargedMinutesAgo !== undefined;
  const createdAt = minutesAgo(plan.createdMinutesAgo);
  const [patient] = await db
    .insert(schema.patients)
    .values({
      ...plan.intake,
      // The form is filled in while the first sitting runs, about a minute after arrival.
      intakeCompletedAt: plan.intake ? new Date(createdAt.getTime() + MINUTE_MS) : null,
      photoUpdatedAt: plan.portrait ? createdAt : null,
      createdAt,
      status: discharged ? "discharged" : "waiting",
      dischargedAt: discharged ? minutesAgo(plan.dischargedMinutesAgo as number) : null,
    })
    .returning();
  if (!patient) throw new Error("The demo patient was not created");
  if (plan.portrait) {
    await db.insert(schema.patientPhotos).values({
      patientId: patient.id,
      jpeg: await drawnPortrait(plan.portrait),
      width: PATIENT_PHOTO_SIZE,
      height: PATIENT_PHOTO_SIZE,
      createdAt,
    });
  }

  for (const [position, sitting] of plan.sittings.entries()) {
    await addSitting(patient.id, cameraId, sitting, position === 0, index * 100 + position + 1);
  }
  if (plan.flagsOpenedMinutesAgo !== undefined) {
    await syncPatients([patient], { now: minutesAgo(plan.flagsOpenedMinutesAgo), notify: false });
  }
  return `${patient.name ?? "Not yet named"} (${patient.number})`;
}

try {
  const userId = await ensureAccount();
  const cameraId = await ensureDevice(userId, "camera", "Front desk phone");
  await ensureDevice(userId, "nurse", "Nurse phone");
  console.log(`Demo account: ${email} / ${password} (verified)`);

  const waiting = await db.$count(schema.patients, eq(schema.patients.status, "waiting"));
  if (waiting > 0 && !process.argv.includes("--more")) {
    console.log(`${waiting} patients are already waiting, so no demo patients were added. Pass --more to add a set.`);
  } else {
    for (const [index, plan] of PLANS.entries()) {
      console.log(`${await addPatient(plan, cameraId, index)}: ${plan.note}`);
    }
  }
} finally {
  await db.$client.end();
}
