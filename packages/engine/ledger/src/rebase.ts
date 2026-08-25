import type { SqliteDb } from "./db.ts";
import { nextEntityState, requiredEffectClass, type EntityState } from "./domain.ts";
import { LedgerError } from "./errors.ts";
import {
  assertMutationLegal,
  commitChangeset,
  getChangeset,
  loadChangesetRow,
  type ChangeRecord,
  type ChangesetDetail,
  type CommitChangeInput,
  type CommitInput,
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
  } catch (cause) {
    if (cause instanceof LedgerError && cause.message === "changeset_not_found") {
      throw new LedgerError("rebase_not_found");
    }
    throw cause;
  }

  const working = new Map<string, EntityState>();
  const kept: CommitChangeInput[] = [];
  const skipped: RebaseSkip[] = [];
  const driftLines: string[] = [];

  for (const change of original.changes) {
    const key = `${change.entity_type}:${change.entity_ref}`;
    let state: EntityState | undefined;
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
    if (state === undefined) {
      skipped.push({ change_id: change.id, reason: `unknown_entity: ${change.entity_type}:${change.entity_ref}` });
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

  const explanation = driftLines.filter((line) => line.length > 0).join("; ") || `mirror drifted under ${original.id}`;
  const rationale = `${original.rationale}\n\nRebased from ${original.id}: ${explanation}`;

  const input: CommitInput = {
    rationale,
    author_id: original.author_id,
    author_kind: original.author_kind,
    changes: kept,
  };
  if (original.agent_meta !== null) {
    input.agent_meta = original.agent_meta;
  }

  const changeset = commitChangeset(db, vault, input, options);

  return {
    original_id: original.id,
    changeset,
    explanation,
    skipped,
  };
}

function replaySkipReason(change: ChangeRecord, state: EntityState | undefined): string | null {
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
    assertMutationLegal(change.mutation, change.entity_type, state, change.payload ?? {});
  } catch (cause) {
    if (cause instanceof LedgerError) {
      return cause.message;
    }
    throw cause;
  }
  return null;
}

function describeDrift(change: ChangeRecord, currentState: EntityState | undefined): string {
  const ref = `${change.entity_type}:${change.entity_ref}`;
  const expected = formatProjection(change.precondition);
  if (currentState === undefined) {
    return `${ref} expected ${expected}, current missing`;
  }
  const current = formatProjection(casProjection(change.entity_type, currentState));
  return `${ref} expected ${expected}, current ${current}`;
}

function formatProjection(value: ChangeRecord["precondition"] | ReturnType<typeof casProjection>): string {
  if (value === undefined) return "undefined";
  const parts: string[] = [];
  if ("stage" in value && value.stage !== undefined) parts.push(`stage ${value.stage}`);
  if ("status" in value && value.status !== undefined) parts.push(`status ${value.status}`);
  if (value.remoteId !== undefined) parts.push(`remoteId ${value.remoteId}`);
  if (parts.length === 0) {
    return JSON.stringify(value);
  }
  return parts.join(", ");
}
