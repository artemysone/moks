import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplyChange, ApplyResult, AtsAdapter } from "./adapters/types.ts";
import { openSqlite } from "./db.ts";
import type { AtsSnapshot } from "./domain.ts";
import { commitChangeset, loadChangeRows, reviewChangeset } from "./ledger.ts";
import { rebaseChangeset } from "./rebase.ts";
import { migrateWorkspace } from "./schema.ts";
import { pullMirror, pushApproved, readStatus } from "./sync.ts";
import { openVault } from "./vault.ts";

function snapshot(overrides: Partial<AtsSnapshot> = {}): AtsSnapshot {
  return {
    ats: "mock",
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
      {
        id: "cand_b",
        remoteId: "C-2",
        name: "Bob",
        email: "bob@example.com",
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
      {
        id: "app_b",
        remoteId: "A-2",
        jobId: "job_1",
        candidateId: "cand_b",
        stage: "Sourced",
      },
    ],
    ...overrides,
  };
}

function adapterFor(current: { value: AtsSnapshot }): AtsAdapter {
  return {
    id: "mock",
    pull: () => current.value,
    apply: () => ({ ok: false, reason: "unsupported" }),
  };
}

describe("pullMirror", () => {
  test("prunes mirror rows that vanished from the snapshot", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    const current = { value: snapshot() };

    pullMirror(db, adapterFor(current));
    expect(readStatus(db).candidates).toBe(2);
    expect(readStatus(db).applications).toBe(2);
    expect(readStatus(db).pipeline).toEqual({ Screen: 1, Sourced: 1 });

    current.value = snapshot({
      candidates: [snapshot().candidates[0]!],
      applications: [snapshot().applications[0]!],
    });
    pullMirror(db, adapterFor(current));

    const status = readStatus(db);
    expect(status.jobs).toBe(1);
    expect(status.candidates).toBe(1);
    expect(status.applications).toBe(1);
    expect(status.pipeline).toEqual({ Screen: 1 });
  });

  test("clears the mirror when the snapshot is empty", () => {
    const db = openSqlite(":memory:");
    migrateWorkspace(db);
    const current = { value: snapshot() };
    pullMirror(db, adapterFor(current));

    current.value = { ats: "mock", jobs: [], candidates: [], applications: [] };
    pullMirror(db, adapterFor(current));

    const status = readStatus(db);
    expect(status.jobs).toBe(0);
    expect(status.candidates).toBe(0);
    expect(status.applications).toBe(0);
    expect(status.ats).toBeNull();
  });
});

type PushHarness = {
  db: ReturnType<typeof openSqlite>;
  vault: ReturnType<typeof openVault>;
  current: { value: AtsSnapshot };
  applies: ApplyChange[];
  pulls: { count: number };
};

function pushHarness(): PushHarness {
  const db = openSqlite(":memory:");
  migrateWorkspace(db);
  const vault = openVault(db, join(mkdtempSync(join(tmpdir(), "moks-sync-")), "vault.key"));
  const current = { value: snapshot() };
  pullMirror(db, adapterFor(current));
  return { db, vault, current, applies: [], pulls: { count: 0 } };
}

function trackingAdapter(
  harness: PushHarness,
  options: { apply: (change: ApplyChange) => ApplyResult; transactional?: boolean },
): AtsAdapter {
  const adapter: AtsAdapter = {
    id: "mock",
    pull: () => {
      harness.pulls.count += 1;
      return harness.current.value;
    },
    apply: (change) => {
      harness.applies.push(change);
      return options.apply(change);
    },
  };
  if (options.transactional) {
    adapter.transaction = (fn) => fn();
  }
  return adapter;
}

function commitNotePlusAdvance(harness: PushHarness): string {
  const changeset = commitChangeset(harness.db, harness.vault, {
    rationale: "Note Ada, advance her application",
    author_id: "recruiter",
    changes: [
      {
        entity_type: "candidate",
        entity_ref: "cand_a",
        mutation: "AddNote",
        effect_class: "reversible",
        payload: { body: "Ping sent" },
      },
      {
        entity_type: "application",
        entity_ref: "app_a",
        mutation: "AdvanceStage",
        effect_class: "compensable",
        payload: { to: "Interview" },
      },
    ],
  });
  reviewChangeset(harness.db, harness.vault, changeset.id, { action: "approve", reviewer_id: "hm" });
  return changeset.id;
}

function keyOf(change: ApplyChange): string {
  const { idempotencyKey } = change as ApplyChange & { idempotencyKey?: string };
  expect(idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  return idempotencyKey as string;
}

describe("pushApproved without adapter.transaction (MCP-style fallback)", () => {
  test("partial apply persists landed results, goes stale, and re-pulls the mirror", () => {
    const harness = pushHarness();
    const id = commitNotePlusAdvance(harness);
    // The remote drifted after commit: app_a already reached Interview, so the
    // AdvanceStage precondition (Screen) will CAS-fail after the note lands.
    harness.current.value = snapshot({
      applications: [
        { ...snapshot().applications[0]!, stage: "Interview" },
        snapshot().applications[1]!,
      ],
    });
    const adapter = trackingAdapter(harness, {
      apply: (change) =>
        change.mutation === "AddNote"
          ? { ok: true, remoteResult: { noteId: "note_1" } }
          : { ok: false, reason: "precondition_failed" },
    });

    const result = pushApproved(harness.db, adapter, harness.vault);

    // The wire item carries no extra fields; partial state lives in the ledger.
    expect(result.pushed).toEqual([{ id, status: "stale", reason: "precondition_failed" }]);
    const rows = loadChangeRows(harness.db, id);
    expect(JSON.parse(rows[0]!.remote_result as string)).toEqual({ noteId: "note_1" });
    expect(rows[1]!.remote_result).toBeNull();
    // The partial apply triggered a mirror re-pull reflecting the remote drift.
    expect(harness.pulls.count).toBe(1);
    expect(readStatus(harness.db).pipeline.Interview).toBe(1);
    expect(readStatus(harness.db).changesets.stale).toBe(1);
  });

  test("failure on the first change persists nothing and skips the re-pull", () => {
    const harness = pushHarness();
    const id = commitNotePlusAdvance(harness);
    const adapter = trackingAdapter(harness, {
      apply: () => ({ ok: false, reason: "precondition_failed" }),
    });

    const result = pushApproved(harness.db, adapter, harness.vault);

    expect(result.pushed).toEqual([{ id, status: "stale", reason: "precondition_failed" }]);
    expect(harness.applies).toHaveLength(1);
    expect(loadChangeRows(harness.db, id).every((row) => row.remote_result === null)).toBe(true);
    expect(harness.pulls.count).toBe(0);
  });

  test("idempotency keys are attached, distinct per change, and stable across a rebase", () => {
    const harness = pushHarness();
    const id = commitNotePlusAdvance(harness);
    harness.current.value = snapshot({
      applications: [
        { ...snapshot().applications[0]!, stage: "Interview" },
        snapshot().applications[1]!,
      ],
    });
    const adapter = trackingAdapter(harness, {
      apply: (change) =>
        change.mutation === "AddNote"
          ? { ok: true, remoteResult: { noteId: "note_1" } }
          : { ok: false, reason: "precondition_failed" },
    });
    pushApproved(harness.db, adapter, harness.vault);
    expect(harness.applies).toHaveLength(2);
    const noteKey = keyOf(harness.applies[0]!);
    expect(keyOf(harness.applies[1]!)).not.toBe(noteKey);

    // Rebase re-stages the note (the applied advance is now illegal and gets
    // skipped); its replayed apply must carry the same key so the server can
    // dedupe it against the original push.
    const rebased = rebaseChangeset(harness.db, harness.vault, id);
    expect(rebased.changeset.changes.map((change) => change.mutation)).toEqual(["AddNote"]);
    if (rebased.changeset.status === "staged") {
      reviewChangeset(harness.db, harness.vault, rebased.changeset.id, { action: "approve", reviewer_id: "hm" });
    }
    harness.applies.length = 0;
    pushApproved(harness.db, adapter, harness.vault, rebased.changeset.id);
    expect(harness.applies).toHaveLength(1);
    expect(keyOf(harness.applies[0]!)).toBe(noteKey);
  });

  test("a transactional adapter keeps the all-or-nothing behavior", () => {
    const harness = pushHarness();
    const id = commitNotePlusAdvance(harness);
    const adapter = trackingAdapter(harness, {
      transactional: true,
      apply: (change) =>
        change.mutation === "AddNote"
          ? { ok: true, remoteResult: { noteId: "note_1" } }
          : { ok: false, reason: "precondition_failed" },
    });

    const result = pushApproved(harness.db, adapter, harness.vault);

    expect(result.pushed).toEqual([{ id, status: "stale", reason: "precondition_failed" }]);
    // No partial persistence and no re-pull on the transactional path.
    expect(loadChangeRows(harness.db, id).every((row) => row.remote_result === null)).toBe(true);
    expect(harness.pulls.count).toBe(0);
  });
});
