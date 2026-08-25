import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlite, type SqlBindings } from "../db.ts";
import { migrateMockAts } from "../schema.ts";
import { createMockAdapter, seedMockAts } from "./mock.ts";

const validFixture = {
  jobs: [
    {
      id: "job_1",
      remoteId: "REQ-1",
      title: "Engineer",
      team: "Payments",
      location: "NYC",
      status: "open",
    },
  ],
  candidates: [
    {
      id: "cand_a",
      remoteId: "C-1",
      name: "Ada",
      email: "ada@example.com",
      headline: "Backend",
    },
  ],
  applications: [
    {
      id: "app_a",
      remoteId: "A-1",
      jobId: "job_1",
      candidateId: "cand_a",
      stage: "Screen",
    },
  ],
};

import type { Json } from "../json.ts";

function writeFixture(body: Json): string {
  const dir = mkdtempSync(join(tmpdir(), "moks-fixture-"));
  const path = join(dir, "mock-ats.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("seedMockAts", () => {
  test("rejects an invalid job status", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const path = writeFixture({
      ...validFixture,
      jobs: [{ ...validFixture.jobs[0], status: "OPEN" }],
    });
    expect(() => seedMockAts(db, path)).toThrow("Invalid fixture job status: OPEN");
  });

  test("rejects an invalid application stage", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const path = writeFixture({
      ...validFixture,
      applications: [{ ...validFixture.applications[0], stage: "PhoneScreen" }],
    });
    expect(() => seedMockAts(db, path)).toThrow("Invalid fixture stage: PhoneScreen");
  });

  test("seeds once, then is a no-op", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const path = writeFixture(validFixture);
    expect(seedMockAts(db, path)).toBe(true);
    expect(seedMockAts(db, path)).toBe(false);
  });
});

describe("createMockAdapter", () => {
  test("prepare seeds, then pull returns the snapshot", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
    expect(adapter.prepare?.().seeded).toBe(true);
    expect(adapter.prepare?.().seeded).toBe(false);
    const pulled = adapter.pull();
    expect(pulled.ats).toBe("mock");
    expect(pulled.jobs).toHaveLength(1);
    expect(pulled.candidates).toHaveLength(1);
    expect(pulled.applications[0]?.stage).toBe("Screen");
  });

  test("apply CAS-updates stage and records notes", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    const failed = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { stage: "Sourced" },
      payload: { to: "Interview" },
    });
    expect(failed).toEqual({ ok: false, reason: "precondition_failed" });

    const advanced = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { stage: "Screen" },
      payload: { to: "Interview" },
    });
    expect(advanced.ok).toBe(true);
    expect(adapter.pull().applications[0]?.stage).toBe("Interview");

    const noted = adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AddNote",
      precondition: { id: "app_a" },
      payload: { body: "Strong systems answers" },
    });
    expect(noted.ok).toBe(true);
    const notes = db.prepare<{ body: string }, SqlBindings>("SELECT body FROM notes").all();
    expect(notes).toEqual([{ body: "Strong systems answers" }]);
  });

  test("skip-stage apply fails closed", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
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

  test("empty precondition is rejected at apply", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
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

  test("job AddNote and AddTag apply", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();
    const noted = adapter.apply({
      entityType: "job",
      entityRef: "job_1",
      mutation: "AddNote",
      precondition: { id: "job_1", status: "open" },
      payload: { body: "Headcount approved" },
    });
    expect(noted.ok).toBe(true);
    const tagged = adapter.apply({
      entityType: "job",
      entityRef: "job_1",
      mutation: "AddTag",
      precondition: { remoteId: "REQ-1" },
      payload: { tag: "priority" },
    });
    expect(tagged.ok).toBe(true);
    const notes = db.prepare("SELECT entity_type, body FROM notes").all();
    expect(notes).toEqual([{ entity_type: "job", body: "Headcount approved" }]);
  });

  test("Reject from a terminal stage fails", () => {
    const db = openSqlite(":memory:");
    migrateMockAts(db);
    const adapter = createMockAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();
    adapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "Reject",
      precondition: { stage: "Screen" },
      payload: {},
    });
    expect(
      adapter.apply({
        entityType: "application",
        entityRef: "app_a",
        mutation: "Reject",
        precondition: { stage: "Rejected" },
        payload: {},
      }),
    ).toEqual({ ok: false, reason: "illegal_transition" });
  });

  test("HIRING path apply accepts Sourced → Screen; default machine rejects it", () => {
    const sourced = {
      ...validFixture,
      applications: [{ ...validFixture.applications[0], stage: "Sourced" }],
    };
    const hiring = ["Sourced", "Screen", "Phone", "Onsite", "Offer", "Hired"] as const;

    const defaultDb = openSqlite(":memory:");
    migrateMockAts(defaultDb);
    const defaultAdapter = createMockAdapter(defaultDb, { fixturePath: writeFixture(sourced) });
    defaultAdapter.prepare?.();
    expect(
      defaultAdapter.apply({
        entityType: "application",
        entityRef: "app_a",
        mutation: "AdvanceStage",
        precondition: { stage: "Sourced" },
        payload: { to: "Screen" },
      }),
    ).toEqual({ ok: false, reason: "illegal_transition" });
    expect(defaultAdapter.pull().applications[0]?.stage).toBe("Sourced");

    const pathDb = openSqlite(":memory:");
    migrateMockAts(pathDb);
    const pathAdapter = createMockAdapter(pathDb, { fixturePath: writeFixture(sourced), stages: hiring });
    pathAdapter.prepare?.();
    const advanced = pathAdapter.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { stage: "Sourced" },
      payload: { to: "Screen" },
    });
    expect(advanced.ok).toBe(true);
    expect(pathAdapter.pull().applications[0]?.stage).toBe("Screen");
  });
});
