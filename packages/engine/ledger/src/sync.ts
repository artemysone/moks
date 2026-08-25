import { createHash } from "node:crypto";
import type { ApplyChange, AtsAdapter } from "./adapters/types.ts";
import type { SqlBindings, SqliteDb } from "./db.ts";
import {
  isStage,
  parseCasField,
  parseMutationPayload,
  type ApplicationStage,
  type AtsSnapshot,
  type RemoteResult,
} from "./domain.ts";
import { LedgerError, VaultError } from "./errors.ts";
import { canonicalJson } from "./hash.ts";
import { parseJsonText } from "./json.ts";
import { loadChangeRows, loadChangesetRow, markChangesetApplied, markChangesetStatus, setChangeRemoteResult } from "./ledger.ts";
import { markConflictingChangesets } from "./plan.ts";
import type { Vault } from "./vault.ts";

export type PullResult = {
  ats: AtsSnapshot["ats"];
  seeded: boolean;
  upserted: {
    jobs: number;
    candidates: number;
    applications: number;
  };
  syncedAt: number;
};

export type StatusReport = {
  ats: AtsSnapshot["ats"] | null;
  syncedAt: number | null;
  jobs: number;
  candidates: number;
  applications: number;
  pipeline: Partial<Record<ApplicationStage, number>>;
  changesets: {
    staged: number;
    approved: number;
    stale: number;
    applied: number;
    rejected: number;
  };
};

export type PushItem = {
  id: string;
  status: "applied" | "stale";
  reason?: string;
};

export type PushResult = {
  pushed: PushItem[];
};

export function pullMirror(workspace: SqliteDb, adapter: AtsAdapter): PullResult {
  const seeded = adapter.prepare?.().seeded ?? false;
  const snapshot = adapter.pull();
  const syncedAt = Date.now();
  const upsert = workspace.prepare(`
    INSERT INTO remote_mirror (entity_type, entity_ref, ats, remote_id, state, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_ref, ats) DO UPDATE SET
      remote_id = excluded.remote_id,
      state = excluded.state,
      synced_at = excluded.synced_at
  `);

  const write = workspace.transaction(() => {
    for (const job of snapshot.jobs) {
      upsert.run("job", job.id, snapshot.ats, job.remoteId, JSON.stringify(job), syncedAt);
    }
    for (const candidate of snapshot.candidates) {
      upsert.run(
        "candidate",
        candidate.id,
        snapshot.ats,
        candidate.remoteId,
        JSON.stringify(candidate),
        syncedAt,
      );
    }
    for (const application of snapshot.applications) {
      upsert.run(
        "application",
        application.id,
        snapshot.ats,
        application.remoteId,
        JSON.stringify(application),
        syncedAt,
      );
    }

    const keep: Array<[string, string]> = [];
    for (const job of snapshot.jobs) keep.push(["job", job.id]);
    for (const candidate of snapshot.candidates) keep.push(["candidate", candidate.id]);
    for (const application of snapshot.applications) keep.push(["application", application.id]);
    if (keep.length === 0) {
      workspace.prepare("DELETE FROM remote_mirror WHERE ats = ?").run(snapshot.ats);
    } else {
      const placeholders = keep.map(() => "(?, ?)").join(", ");
      workspace
        .prepare(
          `DELETE FROM remote_mirror WHERE ats = ? AND (entity_type, entity_ref) NOT IN (${placeholders})`,
        )
        .run(snapshot.ats, ...keep.flat());
    }
  });
  write();
  markConflictingChangesets(workspace);

  return {
    ats: snapshot.ats,
    seeded,
    upserted: {
      jobs: snapshot.jobs.length,
      candidates: snapshot.candidates.length,
      applications: snapshot.applications.length,
    },
    syncedAt,
  };
}

type EntityCountRow = { entity_type: string; n: number };
type StageCountRow = { stage: string; n: number };
type MirrorMetaRow = { ats: StatusReport["ats"]; synced_at: number | null };

export function readStatus(workspace: SqliteDb): StatusReport {
  const counts = workspace
    .prepare<EntityCountRow, SqlBindings>("SELECT entity_type, COUNT(*) AS n FROM remote_mirror GROUP BY entity_type")
    .all();
  let jobs = 0;
  let candidates = 0;
  let applications = 0;
  for (const row of counts) {
    if (row.entity_type === "job") jobs = row.n;
    if (row.entity_type === "candidate") candidates = row.n;
    if (row.entity_type === "application") applications = row.n;
  }

  const pipeline: Partial<Record<ApplicationStage, number>> = {};
  const stages = workspace
    .prepare<StageCountRow, SqlBindings>(
      "SELECT json_extract(state, '$.stage') AS stage, COUNT(*) AS n FROM remote_mirror WHERE entity_type = 'application' AND json_extract(state, '$.stage') IS NOT NULL GROUP BY stage",
    )
    .all();
  for (const row of stages) {
    if (isStage(row.stage)) pipeline[row.stage] = row.n;
  }

  const meta = workspace.prepare<MirrorMetaRow, SqlBindings>("SELECT ats, MAX(synced_at) AS synced_at FROM remote_mirror").get();
  const syncedAt = meta?.synced_at ?? null;
  const ats = syncedAt === null ? null : (meta?.ats ?? null);

  return {
    ats,
    syncedAt,
    jobs,
    candidates,
    applications,
    pipeline,
    changesets: changesetCounts(workspace),
  };
}

type StatusCountRow = { status: string; n: number };

function changesetCounts(workspace: SqliteDb): StatusReport["changesets"] {
  const rows = workspace.prepare<StatusCountRow, SqlBindings>("SELECT status, COUNT(*) AS n FROM changesets GROUP BY status").all();
  const counts: StatusReport["changesets"] = { staged: 0, approved: 0, stale: 0, applied: 0, rejected: 0 };
  for (const row of rows) {
    if (row.status === "staged") counts.staged = row.n;
    if (row.status === "approved") counts.approved = row.n;
    if (row.status === "stale") counts.stale = row.n;
    if (row.status === "applied") counts.applied = row.n;
    if (row.status === "rejected") counts.rejected = row.n;
  }
  return counts;
}

function applyOne(vault: Vault, change: ReturnType<typeof loadChangeRows>[number]): ApplyChange {
  try {
    return {
      entityType: change.entity_type,
      entityRef: change.entity_ref,
      mutation: change.mutation,
      precondition: parseCasField(parseJsonText(change.precondition)),
      payload: parseMutationPayload(change.mutation, vault.get(change.payload_ref)),
    };
  } catch (cause) {
    if (cause instanceof VaultError) {
      throw new LedgerError("payload_unavailable");
    }
    throw cause;
  }
}

const REBASED_FROM = /Rebased from ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/;

/**
 * The changeset id that anchors idempotency keys. Keys must survive a rebase:
 * a rebased changeset re-stages the same logical changes under new row ids,
 * and a replayed apply has to dedupe server-side against what the original
 * push already applied. `rebaseChangeset` appends a `Rebased from <id>: …`
 * trailer to the rationale on every rebase, so the first marker is the
 * pre-rebase root across the whole chain. Distinct changesets with identical
 * content keep distinct keys (their roots differ), preserving CAS conflicts
 * between independent pushes.
 */
function lineageRoot(changesetId: string, rationale: string): string {
  const match = REBASED_FROM.exec(rationale);
  return match?.[1] ?? changesetId;
}

type PreparedChange = {
  change: ReturnType<typeof loadChangeRows>[number];
  apply: ApplyChange & { idempotencyKey: string };
};

function prepareChanges(workspace: SqliteDb, vault: Vault, id: string, rationale: string): PreparedChange[] {
  const root = lineageRoot(id, rationale);
  // Occurrence index disambiguates intentionally identical changes within one
  // changeset (e.g. the same note twice); it is stable across a rebase because
  // identical changes are kept or skipped together, in order.
  const occurrences = new Map<string, number>();
  return loadChangeRows(workspace, id).map((change) => {
    const apply = applyOne(vault, change);
    // The precondition is deliberately excluded: a rebase re-captures it from
    // the refreshed mirror, and the replayed apply must still hit the same key.
    const content = canonicalJson(
      parseJsonText(
        JSON.stringify({
          entityType: apply.entityType,
          entityRef: apply.entityRef,
          mutation: apply.mutation,
          payload: apply.payload,
        }),
      ),
    );
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    const idempotencyKey = createHash("sha256").update(`${root}\n${occurrence}\n${content}`).digest("hex");
    return { change, apply: { ...apply, idempotencyKey } };
  });
}

type PushOutcome = {
  item: PushItem;
  /** True when some changes landed remotely before a later change failed. */
  partialApply: boolean;
};

function pushChangeset(
  workspace: SqliteDb,
  adapter: AtsAdapter,
  vault: Vault,
  id: string,
): PushOutcome {
  const row = loadChangesetRow(workspace, id);
  if (row.status === "staged") {
    throw new LedgerError("review_required");
  }
  if (row.status !== "approved") {
    throw new LedgerError(`cannot_push: ${row.status}`);
  }

  const prepared = prepareChanges(workspace, vault, id, row.rationale);

  if (!adapter.transaction) {
    return pushSequentially(workspace, adapter, id, prepared);
  }

  class ApplyFailed {
    constructor(readonly reason: string) {}
  }

  let results: Array<RemoteResult | undefined>;
  try {
    results = adapter.transaction(() => {
      const applied: Array<RemoteResult | undefined> = [];
      for (const item of prepared) {
        const result = adapter.apply(item.apply);
        if (!result.ok) {
          throw new ApplyFailed(result.reason);
        }
        applied.push(result.remoteResult);
      }
      return applied;
    });
  } catch (cause) {
    if (cause instanceof ApplyFailed) {
      markChangesetStatus(workspace, id, "stale");
      return { item: { id, status: "stale", reason: cause.reason }, partialApply: false };
    }
    throw cause;
  }

  const persist = workspace.transaction(() => {
    for (const [index, item] of prepared.entries()) {
      setChangeRemoteResult(workspace, item.change.id, results[index]);
    }
    markChangesetApplied(workspace, id, Date.now());
  });
  persist();
  return { item: { id, status: "applied" }, partialApply: false };
}

/**
 * Non-transactional adapters (MCP) apply change by change, so a failure can
 * leave the changeset half-applied remotely. Append-only: each successful
 * change's remoteResult is persisted as it lands, the changeset still goes
 * stale, and the caller re-pulls the mirror so partial remote state is
 * reflected. A rebase then re-stages what still applies; replayed applies are
 * deduped server-side by the idempotency key.
 */
function pushSequentially(
  workspace: SqliteDb,
  adapter: AtsAdapter,
  id: string,
  prepared: PreparedChange[],
): PushOutcome {
  let applied = 0;
  for (const item of prepared) {
    const result = adapter.apply(item.apply);
    if (!result.ok) {
      markChangesetStatus(workspace, id, "stale");
      return { item: { id, status: "stale", reason: result.reason }, partialApply: applied > 0 };
    }
    setChangeRemoteResult(workspace, item.change.id, result.remoteResult);
    applied += 1;
  }
  markChangesetApplied(workspace, id, Date.now());
  return { item: { id, status: "applied" }, partialApply: false };
}

export function pushApproved(
  workspace: SqliteDb,
  adapter: AtsAdapter,
  vault: Vault,
  id?: string,
): PushResult {
  // Push in insertion (hash-chain) order; created_at has ms resolution and can tie.
  const ids = id
    ? [id]
    : workspace
        .prepare<{ id: string }, SqlBindings>("SELECT id FROM changesets WHERE status = 'approved' ORDER BY rowid ASC")
        .all()
        .map((row) => row.id);
  if (id) {
    loadChangesetRow(workspace, id);
  }
  const pushed: PushItem[] = [];
  let partialApply = false;
  for (const changesetId of ids) {
    const outcome = pushChangeset(workspace, adapter, vault, changesetId);
    pushed.push(outcome.item);
    partialApply ||= outcome.partialApply;
  }
  if (partialApply) {
    // A half-applied changeset left the remote ahead of the mirror; re-pull so
    // the drift is visible (pullMirror also re-marks conflicting changesets).
    pullMirror(workspace, adapter);
  } else {
    markConflictingChangesets(workspace);
  }
  return { pushed };
}

export function refreshAfterPush(workspace: SqliteDb, adapter: AtsAdapter, result: PushResult): void {
  if (result.pushed.some((item) => item.status === "applied")) {
    pullMirror(workspace, adapter);
    return;
  }
  markConflictingChangesets(workspace);
}
