import type { SqliteDb } from "./db.ts";
import { nextEntityState, requiredEffectClass } from "./domain.ts";
import { LedgerError } from "./errors.ts";
import {
  assertMutationLegal,
  commitChangeset,
  getChangeset,
  loadChangesetRow,
  type ChangeRecord,
  type ChangesetDetail,
  type CommitChangeInput,
  type CommitPolicyOptions,
} from "./ledger.ts";
import { readMirrorEntity } from "./mirror.ts";
import { casProjection } from "./precondition.ts";
import type { Vault } from "./vault.ts";

export type RebaseSkip = { change_id: string; reason: string };

export type RebaseResult = {
  original_id: string;
  changeset: ChangesetDetail;
  explanation: string;
  skipped: RebaseSkip[];
};

export function rebaseChangeset(
  db: SqliteDb,
  vault: Vault,
  id: string,
  options?: CommitPolicyOptions,
): RebaseResult {
  let original: ChangesetDetail;
  try {
    const row = loadChangesetRow(db, id);
    if (row.status !== "stale") {
      throw new LedgerError("rebase_not_stale");
    }
    original = getChangeset(db, vault, id);
  } catch (error) {
    if (error instanceof LedgerError && error.message === "changeset_not_found") {
      throw new LedgerError("rebase_not_found");
    }
    throw error;
  }

  const working = new Map<string, unknown>();
  const kept: CommitChangeInput[] = [];
  const skipped: RebaseSkip[] = [];
  const driftLines: string[] = [];

  for (const change of original.changes) {
    const key = `${change.entity_type}:${change.entity_ref}`;
    let state: unknown;
    if (working.has(key)) {
      state = working.get(key);
    } else {
      const mirror = readMirrorEntity(db, change.entity_type, change.entity_ref);
      state = mirror?.state;
      driftLines.push(describeDrift(change, state));
    }

    if (change.payload_redacted || change.payload === null) {
      skipped.push({ change_id: change.id, reason: "payload_unavailable" });
      continue;
    }

    const reason = replaySkipReason(change, state);
    if (reason) {
      skipped.push({ change_id: change.id, reason });
      continue;
    }

    kept.push({
      entity_type: change.entity_type,
      entity_ref: change.entity_ref,
      mutation: change.mutation,
      effect_class: change.effect_class,
      payload: change.payload,
    });
    working.set(key, nextEntityState(state, change.mutation, change.payload));
  }

  if (kept.length === 0) {
    throw new LedgerError("rebase_empty");
  }

  const explanation =
    driftLines.filter((line) => line.length > 0).join("; ") ||
    `mirror drifted under ${original.id}`;
  const rationale = `${original.rationale}\n\nRebased from ${original.id}: ${explanation}`;

  const changeset = commitChangeset(
    db,
    vault,
    {
      rationale,
      author_id: original.author_id,
      author_kind: original.author_kind,
      ...(original.agent_meta !== null && original.agent_meta !== undefined
        ? { agent_meta: original.agent_meta }
        : {}),
      changes: kept,
    },
    options,
  );

  return {
    original_id: original.id,
    changeset,
    explanation,
    skipped,
  };
}

function replaySkipReason(change: ChangeRecord, state: unknown): string | null {
  if (change.effect_class !== requiredEffectClass(change.mutation)) {
    return `effect_class_mismatch: ${change.mutation} requires ${requiredEffectClass(change.mutation)}`;
  }
  if (state === undefined) {
    return `unknown_entity: ${change.entity_type}:${change.entity_ref}`;
  }
  const projection = casProjection(change.entity_type, state);
  if (!projection) {
    return `unknown_entity: ${change.entity_type}:${change.entity_ref} state is invalid`;
  }
  try {
    assertMutationLegal(change.mutation, change.entity_type, state, change.payload);
  } catch (error) {
    if (error instanceof LedgerError) {
      return error.message;
    }
    throw error;
  }
  return null;
}

function describeDrift(change: ChangeRecord, currentState: unknown): string {
  const ref = `${change.entity_type}:${change.entity_ref}`;
  const expected = formatProjection(change.precondition);
  if (currentState === undefined) {
    return `${ref} expected ${expected}, current missing`;
  }
  const current = formatProjection(casProjection(change.entity_type, currentState));
  return `${ref} expected ${expected}, current ${current}`;
}

function formatProjection(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return String(value);
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.stage === "string") {
    parts.push(`stage ${record.stage}`);
  }
  if (typeof record.status === "string") {
    parts.push(`status ${record.status}`);
  }
  if (typeof record.remoteId === "string") {
    parts.push(`remoteId ${record.remoteId}`);
  }
  if (parts.length === 0) {
    return JSON.stringify(value);
  }
  return parts.join(", ");
}
