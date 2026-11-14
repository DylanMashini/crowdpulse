// The cool-down claim against a real database. Skipped without DATABASE_URL, which `pnpm test`
// does not set: run it with
//   DATABASE_URL=postgres://localhost:5432/triagecam node --test src/server/push.test.ts
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

describe("claimPush", { skip: !process.env.DATABASE_URL }, () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  after(async () => {
    for (const undo of cleanup) await undo();
  });

  it("lets one of many overlapping pushes for a patient through, then none until the cool-down ends", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("../db/client.ts");
    const { claimPush } = await import("./push.ts");
    cleanup.push(() => db.$client.end());

    const { sql } = await import("drizzle-orm");
    // Open every pooled connection first, so the attempts below really do overlap.
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`select pg_sleep(0.05)`)));

    const detail = { handoff: "test" } as (typeof schema.flags.$inferInsert)["detail"];
    const rules = ["score_rise", "baseline_shift", "overdue"] as const;
    const now = new Date();
    let first: { flagId: string; patientId: string } | undefined;

    for (let round = 0; round < 10; round += 1) {
      const [patient] = await db.insert(schema.patients).values({}).returning();
      assert.ok(patient);
      cleanup.unshift(() => db.delete(schema.patients).where(eq(schema.patients.id, patient.id)));
      const flags = await db
        .insert(schema.flags)
        .values(rules.map((rule) => ({ patientId: patient.id, rule, detail })))
        .returning();
      first ??= { flagId: flags[0]!.id, patientId: patient.id };

      // Two server processes during a deploy, each with a flag of the same patient to announce.
      const attempts = Array.from({ length: 30 }, (_, index) => flags[index % flags.length]!);
      const results = await Promise.all(attempts.map((flag) => claimPush(flag.id, patient.id, 10, now)));
      assert.equal(results.filter(Boolean).length, 1, "exactly one push goes out");

      const stamped = await db.select().from(schema.flags).where(eq(schema.flags.patientId, patient.id));
      assert.equal(stamped.filter((flag) => flag.lastNotifiedAt !== null).length, 1);
    }

    assert.ok(first);
    const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    assert.equal(await claimPush(first.flagId, first.patientId, 10, later(9)), false, "inside the cool-down");
    assert.equal(await claimPush(first.flagId, first.patientId, 10, later(11)), true, "after the cool-down");
  });
});
