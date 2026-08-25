import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite } from "../db.ts";
import { createGreenhouseAdapter, migrateGreenhouse, seedGreenhouse } from "./greenhouse.ts";

const repoFixture = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/mock-greenhouse.json");

const validFixture = {
  jobs: [
    {
      id: "job_1",
      remoteId: "GH-JOB-1",
      title: "Engineer",
      team: "Payments",
      location: "SF",
      status: "open",
    },
  ],
  candidates: [
    {
      id: "cand_a",
      remoteId: "GH-CAND-1",
      name: "Ada",
      email: "ada@example.com",
      headline: "Backend",
    },
  ],
  applications: [
    {
      id: "app_a",
      remoteId: "GH-APP-1",
      jobId: "job_1",
      candidateId: "cand_a",
      stage: "Screen",
    },
  ],
};

import type { Json } from "../json.ts";

function writeFixture(body: Json): string {
  const dir = mkdtempSync(join(tmpdir(), "moks-gh-fixture-"));
  const path = join(dir, "mock-greenhouse.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("seedGreenhouse", () => {
  test("rejects an invalid job status", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const path = writeFixture({
      ...validFixture,
      jobs: [{ ...validFixture.jobs[0], status: "OPEN" }],
    });
    expect(() => seedGreenhouse(db, path)).toThrow("Invalid fixture job status: OPEN");
  });

  test("rejects an invalid application stage", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const path = writeFixture({
      ...validFixture,
      applications: [{ ...validFixture.applications[0], stage: "PhoneScreen" }],
    });
    expect(() => seedGreenhouse(db, path)).toThrow("Invalid fixture stage: PhoneScreen");
  });

  test("seeds once, then is a no-op", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const path = writeFixture(validFixture);
    expect(seedGreenhouse(db, path)).toBe(true);
    expect(seedGreenhouse(db, path)).toBe(false);
  });
});

describe("createGreenhouseAdapter", () => {
  test("prepare seeds, then pull returns the snapshot", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    expect(adapter.prepare?.().seeded).toBe(true);
    expect(adapter.prepare?.().seeded).toBe(false);
    const pulled = adapter.pull();
    expect(pulled.ats).toBe("greenhouse");
    expect(pulled.jobs).toHaveLength(1);
    expect(pulled.candidates).toHaveLength(1);
    expect(pulled.applications[0]?.stage).toBe("Screen");
    expect(pulled.jobs[0]?.remoteId).toBe("GH-JOB-1");
  });

  test("seeds the repo fixture with moks stages and GH remote ids", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: repoFixture });
    expect(adapter.prepare?.().seeded).toBe(true);
    const pulled = adapter.pull();
    expect(pulled.jobs).toHaveLength(1);
    expect(pulled.candidates).toHaveLength(3);
    expect(pulled.applications).toHaveLength(3);
    expect(pulled.jobs[0]?.remoteId.startsWith("GH-")).toBe(true);
    expect(pulled.candidates.every((c) => c.remoteId.startsWith("GH-"))).toBe(true);
    expect(pulled.applications.every((a) => a.remoteId.startsWith("GH-"))).toBe(true);
    expect(new Set(pulled.applications.map((a) => a.stage))).toEqual(
      new Set(["Screen", "Sourced", "Interview"]),
    );
  });
});

describe("apply CAS", () => {
  test("AdvanceStage succeeds when the precondition matches", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const result = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { stage: "Screen" },
      payload: { to: "Interview" },
    });

    expect(result).toEqual({
      ok: true,
      remoteResult: expect.objectContaining({ id: "app_a", stage: "Interview" }),
    });
    expect(adapter.pull().applications[0]?.stage).toBe("Interview");
  });

  test("returns precondition_failed when CAS does not match", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const result = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { stage: "Interview" },
      payload: { to: "Offer" },
    });

    expect(result).toEqual({ ok: false, reason: "precondition_failed" });
    expect(adapter.pull().applications[0]?.stage).toBe("Screen");
  });

  test("Reject writes Rejected when the precondition matches", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const result = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "Reject",
      precondition: { id: "app_a", stage: "Screen" },
      payload: {},
    });

    expect(result.ok).toBe(true);
    expect(adapter.pull().applications[0]?.stage).toBe("Rejected");
  });

  test("empty precondition is rejected at apply", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();
    expect(
      adapter.apply({
        entityType: "application",
        entityRef: "app_a",
        mutation: "AdvanceStage",
        precondition: {},
        payload: { to: "Interview" },
      }),
    ).toEqual({ ok: false, reason: "empty_precondition" });
  });

  test("skip-stage apply fails closed", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();
    expect(
      adapter.apply({
        entityType: "application",
        entityRef: "app_a",
        mutation: "AdvanceStage",
        precondition: { stage: "Screen" },
        payload: { to: "Offer" },
      }),
    ).toEqual({ ok: false, reason: "illegal_transition" });
    expect(adapter.pull().applications[0]?.stage).toBe("Screen");
  });

  test("job AddNote applies", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();
    const noted = adapter.apply({
      entityType: "job",
      entityRef: "job_1",
      mutation: "AddNote",
      precondition: { id: "job_1", status: "open" },
      payload: { body: "Headcount approved" },
    });
    expect(noted.ok).toBe(true);
    const notes = db.prepare("SELECT entity_type, body FROM greenhouse_notes").all();
    expect(notes).toEqual([{ entity_type: "job", body: "Headcount approved" }]);
  });

  test("SendOutreach applies and CAS-fails on a stale precondition", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const failed = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "SendOutreach",
      precondition: { stage: "Interview" },
      payload: { body: "Hi Ada" },
    });
    expect(failed).toEqual({ ok: false, reason: "precondition_failed" });

    const sent = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "SendOutreach",
      precondition: { id: "app_a", stage: "Screen" },
      payload: { body: "Hi Ada", channel: "email" },
    });
    expect(sent.ok).toBe(true);
    expect(sent).toEqual({
      ok: true,
      remoteResult: expect.objectContaining({ channel: "email" }),
    });
    const rows = db.prepare("SELECT entity_ref, channel, body FROM greenhouse_outreach").all();
    expect(rows).toEqual([{ entity_ref: "app_a", channel: "email", body: "Hi Ada" }]);
  });

  test("ExtendOffer applies and CAS-fails on a stale precondition", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const failed = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "ExtendOffer",
      precondition: { stage: "Offer" },
      payload: { terms: "185k + 0.1%" },
    });
    expect(failed).toEqual({ ok: false, reason: "precondition_failed" });

    const offered = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "ExtendOffer",
      precondition: { id: "app_a", stage: "Screen" },
      payload: { terms: "185k + 0.1%" },
    });
    expect(offered.ok).toBe(true);
    const rows = db.prepare("SELECT entity_ref, terms FROM greenhouse_offers").all();
    expect(rows).toEqual([{ entity_ref: "app_a", terms: "185k + 0.1%" }]);
  });

  test("returns unsupported for a missing entity", () => {
    const db = openSqlite(":memory:");
    migrateGreenhouse(db);
    const adapter = createGreenhouseAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    expect(
      adapter.apply({
        entityType: "application",
        entityRef: "app_missing",
        mutation: "AdvanceStage",
        precondition: { stage: "Screen" },
        payload: { to: "Interview" },
      }),
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});
