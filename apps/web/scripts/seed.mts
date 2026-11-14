// Creates a verified demo staff account, two devices and a waiting room with one ticket in
// each state, so the dashboard and the nurse role have something to show. Rows are written
// straight to the database because their times are in the past; the flags are then opened
// by the same trend rules the server runs. Run with `pnpm db:seed`.
//
// The demo tickets are added only to an empty waiting room. Pass --more to add another set.
import { eq } from "drizzle-orm";

import { db, schema } from "../src/db/client.ts";
import { hashPassword } from "../src/server/auth/passwords.ts";
import { syncTickets } from "../src/server/trend/engine.ts";

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

type TicketPlan = {
  note: string;
  createdMinutesAgo: number;
  dischargedMinutesAgo?: number;
  sittings: SittingPlan[];
  /** Minutes before now at which the server would have run its rules and opened the flags. */
  flagsOpenedMinutesAgo?: number;
};

const PLANS: TicketPlan[] = [
  {
    note: "steady, observed",
    createdMinutesAgo: 52,
    sittings: [
      { endedMinutesAgo: 50, heartRate: 74, breathingRate: 15, withReference: true },
      { endedMinutesAgo: 22, heartRate: 76, breathingRate: 16, withReference: true },
    ],
  },
  {
    note: "trend flag: pulse and breathing up on two consecutive observations",
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
    createdMinutesAgo: 49,
    sittings: [{ endedMinutesAgo: 47, heartRate: 68, breathingRate: 14 }],
    flagsOpenedMinutesAgo: 16,
  },
  {
    note: "no reading: the re-check gave no signal",
    createdMinutesAgo: 27,
    sittings: [
      { endedMinutesAgo: 25, heartRate: 88, breathingRate: 18, withReference: true },
      { endedMinutesAgo: 4, heartRate: null, breathingRate: null },
    ],
  },
  { note: "just arrived, not yet observed", createdMinutesAgo: 2, sittings: [] },
  {
    note: "discharged",
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

async function addSitting(ticketId: string, deviceId: string, plan: SittingPlan, isFirst: boolean, seed: number) {
  const next = random(seed);
  const jitter = (spread: number) => (next() - 0.5) * 2 * spread;
  const endedAt = minutesAgo(plan.endedMinutesAgo);
  const startedAt = new Date(endedAt.getTime() - SITTING_SECONDS * 1000);
  const heartSeconds = plan.heartRate === null ? 0 : SITTING_SECONDS - FIRST_HEART_RATE_SECOND + 1;
  const breathingSeconds = plan.breathingRate === null ? 0 : SITTING_SECONDS - FIRST_BREATHING_SECOND + 1;

  const [sitting] = await db
    .insert(schema.sittings)
    .values({
      ticketId,
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
      ticketId,
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

async function addTicket(plan: TicketPlan, cameraId: string, index: number): Promise<number> {
  const discharged = plan.dischargedMinutesAgo !== undefined;
  const [ticket] = await db
    .insert(schema.tickets)
    .values({
      createdAt: minutesAgo(plan.createdMinutesAgo),
      status: discharged ? "discharged" : "waiting",
      dischargedAt: discharged ? minutesAgo(plan.dischargedMinutesAgo as number) : null,
    })
    .returning();
  if (!ticket) throw new Error("The demo ticket was not created");

  for (const [position, sitting] of plan.sittings.entries()) {
    await addSitting(ticket.id, cameraId, sitting, position === 0, index * 100 + position + 1);
  }
  if (plan.flagsOpenedMinutesAgo !== undefined) {
    await syncTickets([ticket], { now: minutesAgo(plan.flagsOpenedMinutesAgo), notify: false });
  }
  return ticket.number;
}

try {
  const userId = await ensureAccount();
  const cameraId = await ensureDevice(userId, "camera", "Front desk phone");
  await ensureDevice(userId, "nurse", "Nurse phone");
  console.log(`Demo account: ${email} / ${password} (verified)`);

  const waiting = await db.$count(schema.tickets, eq(schema.tickets.status, "waiting"));
  if (waiting > 0 && !process.argv.includes("--more")) {
    console.log(`${waiting} tickets are already waiting, so no demo tickets were added. Pass --more to add a set.`);
  } else {
    for (const [index, plan] of PLANS.entries()) {
      console.log(`Ticket ${await addTicket(plan, cameraId, index)}: ${plan.note}`);
    }
  }
} finally {
  await db.$client.end();
}
