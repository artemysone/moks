import type { SqliteDb } from "./db.ts";
import type { ChangesetStatus, EntityType, Mutation } from "./domain.ts";
import { nextEntityState } from "./domain.ts";
import { getChangeset, loadChangeRows, markChangesetStatus, type ChangeRecord } from "./ledger.ts";
import { readMirrorEntity } from "./mirror.ts";
import { casProjection, matchesPrecondition } from "./precondition.ts";
import type { Vault } from "./vault.ts";

export type ChangePlan = {
  id: string;
  entity_type: ChangeRecord["entity_type"];
  entity_ref: string;
  mutation: ChangeRecord["mutation"];
  effect_class: ChangeRecord["effect_class"];
  current: unknown;
  precondition: unknown;
  payload: unknown;
  payload_redacted: boolean;
  drift: boolean;
};

export type ChangesetDiff = {
  id: string;
  status: ChangesetStatus;
  rationale: string;
  drift: boolean;
  changes: ChangePlan[];
};

function firstImagesConflict(db: SqliteDb, changesetId: string): boolean {
  const seen = new Set<string>();
  for (const change of loadChangeRows(db, changesetId)) {
    const key = `${change.entity_type}:${change.entity_ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const mirror = readMirrorEntity(db, change.entity_type as EntityType, change.entity_ref);
    const projected = mirror ? casProjection(change.entity_type as EntityType, mirror.state) : undefined;
    let expected: unknown;
    try {
      expected = JSON.parse(change.precondition) as unknown;
    } catch {
      return true;
    }
    if (projected === undefined || !matchesPrecondition(projected, expected)) {
      return true;
    }
  }
  return false;
}

export function markConflictingChangesets(db: SqliteDb): void {
  const rows = db
    .prepare("SELECT id FROM changesets WHERE status IN ('staged', 'approved')")
    .all() as Array<{ id: string }>;
  for (const { id } of rows) {
    if (firstImagesConflict(db, id)) {
      markChangesetStatus(db, id, "stale");
    }
  }
}

function planChange(
  change: ChangeRecord,
  working: Map<string, unknown>,
  db: SqliteDb,
): ChangePlan {
  const key = `${change.entity_type}:${change.entity_ref}`;
  let state = working.get(key);
  if (state === undefined) {
    const mirror = readMirrorEntity(db, change.entity_type, change.entity_ref);
    state = mirror?.state ?? null;
  }
  const projected = state === null ? undefined : casProjection(change.entity_type, state);
  const drift = projected === undefined || !matchesPrecondition(projected, change.precondition);
  working.set(key, nextEntityState(state, change.mutation as Mutation, change.payload));
  return {
    id: change.id,
    entity_type: change.entity_type,
    entity_ref: change.entity_ref,
    mutation: change.mutation,
    effect_class: change.effect_class,
    current: state,
    precondition: change.precondition,
    payload: change.payload,
    payload_redacted: change.payload_redacted,
    drift,
  };
}

export function diffChangeset(db: SqliteDb, vault: Vault, id: string): ChangesetDiff {
  const changeset = getChangeset(db, vault, id);
  const working = new Map<string, unknown>();
  const changes = changeset.changes.map((change) => planChange(change, working, db));
  const drift = changes.some((change) => change.drift);
  let status = changeset.status;
  if (drift && (status === "staged" || status === "approved")) {
    markChangesetStatus(db, id, "stale");
    status = "stale";
  }
  return {
    id: changeset.id,
    status,
    rationale: changeset.rationale,
    drift,
    changes,
  };
}
