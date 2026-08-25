import type { SqlBindings, SqliteDb } from "./db.ts";
import type { CasField, ChangesetStatus, EntityState, MutationPayload } from "./domain.ts";
import { nextEntityState, parseCasField } from "./domain.ts";
import { parseJsonText } from "./json.ts";
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
  current: EntityState | null;
  precondition: CasField;
  payload: MutationPayload | null;
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

type ChangesetIdRow = { id: string };

function firstImagesConflict(db: SqliteDb, changesetId: string): boolean {
  const seen = new Set<string>();
  for (const change of loadChangeRows(db, changesetId)) {
    const key = `${change.entity_type}:${change.entity_ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const mirror = readMirrorEntity(db, change.entity_type, change.entity_ref);
    const projected = mirror ? casProjection(change.entity_type, mirror.state) : undefined;
    let expected: CasField;
    try {
      expected = parseCasField(parseJsonText(change.precondition));
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
    .prepare<ChangesetIdRow, SqlBindings>("SELECT id FROM changesets WHERE status IN ('staged', 'approved')")
    .all();
  for (const row of rows) {
    if (firstImagesConflict(db, row.id)) {
      markChangesetStatus(db, row.id, "stale");
    }
  }
}

function planChange(change: ChangeRecord, working: Map<string, EntityState>, db: SqliteDb): ChangePlan {
  const key = `${change.entity_type}:${change.entity_ref}`;
  let state = working.get(key);
  if (state === undefined) {
    const mirror = readMirrorEntity(db, change.entity_type, change.entity_ref);
    state = mirror?.state;
  }
  const current = state ?? null;
  const projected = current === null ? undefined : casProjection(change.entity_type, current);
  const drift = projected === undefined || !matchesPrecondition(projected, change.precondition);
  if (current !== null && change.payload !== null) {
    working.set(key, nextEntityState(current, change.mutation, change.payload));
  }
  return {
    id: change.id,
    entity_type: change.entity_type,
    entity_ref: change.entity_ref,
    mutation: change.mutation,
    effect_class: change.effect_class,
    current,
    precondition: change.precondition,
    payload: change.payload,
    payload_redacted: change.payload_redacted,
    drift,
  };
}

export function diffChangeset(db: SqliteDb, vault: Vault, id: string): ChangesetDiff {
  const changeset = getChangeset(db, vault, id);
  const working = new Map<string, EntityState>();
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
