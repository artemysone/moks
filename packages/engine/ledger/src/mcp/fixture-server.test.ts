import { describe, expect, test } from "bun:test";
import { createFixtureState } from "./fixture-server.ts";

function fixtureState() {
  return createFixtureState({
    ats: "ashby",
    jobs: [
      {
        id: "job_1",
        remoteId: "R-1",
        title: "Engineer",
        team: "Core",
        location: "Remote",
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
  });
}

describe("fixture server idempotency", () => {
  test("a replayed key returns the recorded result instead of re-executing", () => {
    const state = fixtureState();
    const addNote = (idempotencyKey: string) =>
      state.apply({
        entityType: "candidate",
        entityRef: "cand_a",
        mutation: "AddNote",
        precondition: { id: "cand_a", remoteId: "C-1" },
        payload: { body: "ping" },
        idempotencyKey,
      });

    const first = addNote("key-1");
    expect(first.ok).toBe(true);
    const replayed = addNote("key-1");
    expect(replayed).toEqual(first);

    // A different key is a distinct intent: it executes and mints a new note.
    const second = addNote("key-2");
    expect(second.ok).toBe(true);
    expect(second).not.toEqual(first);
  });

  test("a replayed key dedupes even after the entity state moved on", () => {
    const state = fixtureState();
    const advance = (idempotencyKey: string) =>
      state.apply({
        entityType: "application",
        entityRef: "app_a",
        mutation: "AdvanceStage",
        precondition: { id: "app_a", remoteId: "A-1", stage: "Screen" },
        payload: { to: "Interview" },
        idempotencyKey,
      });

    const first = advance("key-1");
    expect(first.ok).toBe(true);
    // Same mutation, same (now stale) precondition: a fresh key CAS-fails,
    // while a replay of the recorded key returns the original result.
    expect(advance("key-2")).toEqual({ ok: false, reason: "precondition_failed" });
    expect(advance("key-1")).toEqual(first);
  });

  test("failed applies are not recorded: the key stays usable for a corrected retry", () => {
    const state = fixtureState();
    const failed = state.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { id: "app_a", remoteId: "A-1", stage: "Interview" },
      payload: { to: "Offer" },
      idempotencyKey: "key-1",
    });
    expect(failed).toEqual({ ok: false, reason: "precondition_failed" });

    const retried = state.apply({
      entityType: "application",
      entityRef: "app_a",
      mutation: "AdvanceStage",
      precondition: { id: "app_a", remoteId: "A-1", stage: "Screen" },
      payload: { to: "Interview" },
      idempotencyKey: "key-1",
    });
    expect(retried.ok).toBe(true);
  });

  test("applies without a key never dedupe", () => {
    const state = fixtureState();
    const addNote = () =>
      state.apply({
        entityType: "candidate",
        entityRef: "cand_a",
        mutation: "AddNote",
        precondition: { id: "cand_a", remoteId: "C-1" },
        payload: { body: "ping" },
      });
    const first = addNote();
    const second = addNote();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second).not.toEqual(first);
  });
});
