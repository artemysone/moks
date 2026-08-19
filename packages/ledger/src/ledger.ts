import type { SqliteDb } from "./db.ts";
import {
  canExitToTerminal,
  canExtendOffer,
  isAuthorKind,
  isEffectClass,
  isEntityType,
  isLegalAdvance,
  isMutation,
  isStage,
  nextEntityState,
  requiredEffectClass,
  type AuthorKind,
  type ChangesetStatus,
  type EffectClass,
  type EntityType,
  type Mutation,
} from "./domain.ts";
import { LedgerError } from "./errors.ts";
import {
  GENESIS_PARENT_HASH,
  hashChangeset,
  payloadCipherHash,
  type CanonicalBody,
  type CanonicalChange,
} from "./hash.ts";
import { asApplication, candidateRefFor, readMirrorEntity } from "./mirror.ts";
import { casProjection, isEmptyPrecondition, matchesPrecondition } from "./precondition.ts";
import { failClosedPolicy, gateFor, sampleReject, type Policy } from "./policy.ts";
import type { Vault } from "./vault.ts";
import { VaultError } from "./errors.ts";

const CHANGESET_COLS =
  "id, parent_id, hash, author_kind, author_id, agent_meta, rationale, status, created_at, reviewed_by, applied_at, audit";

export type CommitPolicyOptions = {
  policy?: Policy;
  rng?: () => number;
};

export type CommitChangeInput = {
  entity_type: string;
  entity_ref: string;
  mutation: string;
  effect_class: string;
  precondition?: unknown;
  payload: unknown;
};

export type CommitInput = {
  rationale: string;
  author_id: string;
  author_kind?: string;
  agent_meta?: unknown;
  changes: CommitChangeInput[];
};

export type ChangeRecord = {
  id: string;
  entity_type: EntityType;
  entity_ref: string;
  mutation: Mutation;
  effect_class: EffectClass;
  precondition: unknown;
  payload_ref: string;
  payload: unknown;
  payload_redacted: boolean;
  remote_result: unknown;
};

export type ChangesetDetail = {
  id: string;
  parent_id: string | null;
  hash: string;
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: unknown;
  rationale: string;
  status: ChangesetStatus;
  created_at: number;
  reviewed_by: string | null;
  applied_at: number | null;
  audit: boolean;
  changes: ChangeRecord[];
};

export type ChangesetSummary = Omit<ChangesetDetail, "changes">;

export type AuditEntry = {
  id: string;
  parent_id: string | null;
  hash: string;
  status: ChangesetStatus;
  author_kind: AuthorKind;
  author_id: string;
  reviewed_by: string | null;
  rationale: string;
  created_at: number;
  applied_at: number | null;
  audit: boolean;
};

type ChangesetRow = {
  id: string;
  parent_id: string | null;
  hash: string;
  author_kind: AuthorKind;
  author_id: string;
  agent_meta: string | null;
  rationale: string;
  status: ChangesetStatus;
  created_at: number;
  reviewed_by: string | null;
  applied_at: number | null;
  audit: number;
};

type ChangeRow = {
  id: string;
  changeset_id: string;
  entity_type: EntityType;
  entity_ref: string;
  mutation: Mutation;
  effect_class: EffectClass;
  precondition: string;
  payload_ref: string;
  remote_result: string | null;
};

function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as unknown;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LedgerError(message);
  }
  return value;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LedgerError("invalid_payload");
  }
  return payload as Record<string, unknown>;
}

function validatePayload(mutation: Mutation, payload: unknown): void {
  const record = payloadRecord(payload);
  switch (mutation) {
    case "AdvanceStage":
      if (typeof record.to !== "string" || !isStage(record.to)) {
        throw new LedgerError("invalid_payload: AdvanceStage requires to");
      }
      return;
    case "AddNote":
      if (typeof record.body !== "string" || record.body.length === 0) {
        throw new LedgerError("invalid_payload: AddNote requires body");
      }
      return;
    case "AddTag":
      if (typeof record.tag !== "string" || record.tag.length === 0) {
        throw new LedgerError("invalid_payload: AddTag requires tag");
      }
      return;
    case "SendOutreach":
      if (typeof record.body !== "string" || record.body.length === 0) {
        throw new LedgerError("invalid_payload: SendOutreach requires body");
      }
      return;
    case "ExtendOffer":
      if (typeof record.terms !== "string" || record.terms.length === 0) {
        throw new LedgerError("invalid_payload: ExtendOffer requires terms");
      }
      return;
    case "Reject":
    case "Withdraw":
      return;
  }
}

/** Throws LedgerError if payload or transition would be rejected at commit. */
export function assertMutationLegal(
  mutation: Mutation,
  entityType: EntityType,
  state: unknown,
  payload: unknown,
): void {
  validatePayload(mutation, payload);
  validateTransition(mutation, entityType, state, payload);
}

function validateTransition(mutation: Mutation, entityType: EntityType, state: unknown, payload: unknown): void {
  if (mutation === "AddNote" || mutation === "AddTag" || mutation === "SendOutreach") {
    return;
  }
  if (mutation === "ExtendOffer") {
    if (entityType !== "application") {
      throw new LedgerError("illegal_entity: ExtendOffer requires application");
    }
    const application = asApplication(state);
    if (!application) {
      throw new LedgerError("unknown_entity: application state is invalid");
    }
    if (!canExtendOffer(application.stage)) {
      throw new LedgerError(`illegal_transition: ${application.stage} → ExtendOffer`);
    }
    return;
  }
  if (entityType !== "application") {
    throw new LedgerError(`illegal_entity: ${mutation} requires application`);
  }
  const application = asApplication(state);
  if (!application) {
    throw new LedgerError("unknown_entity: application state is invalid");
  }
  if (mutation === "AdvanceStage") {
    const to = (payloadRecord(payload).to as string) ?? "";
    if (!isLegalAdvance(application.stage, isStage(to) ? to : application.stage) || !isStage(to)) {
      throw new LedgerError(`illegal_transition: ${application.stage} → ${to}`);
    }
    return;
  }
  if (mutation === "Reject") {
    if (!canExitToTerminal(application.stage)) {
      throw new LedgerError(`illegal_transition: ${application.stage} → Rejected`);
    }
    return;
  }
  if (mutation === "Withdraw") {
    if (!canExitToTerminal(application.stage)) {
      throw new LedgerError(`illegal_transition: ${application.stage} → Withdrawn`);
    }
  }
}

function tip(db: SqliteDb): { id: string; hash: string } | undefined {
  return db.prepare("SELECT id, hash FROM changesets ORDER BY rowid DESC LIMIT 1").get() as
    | { id: string; hash: string }
    | undefined;
}

function loadChangeRows(db: SqliteDb, changesetId: string): ChangeRow[] {
  return db
    .prepare(
      "SELECT id, changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref, remote_result FROM changes WHERE changeset_id = ? ORDER BY seq ASC, id ASC",
    )
    .all(changesetId) as ChangeRow[];
}

function toChangeRecord(row: ChangeRow, vault: Vault): ChangeRecord {
  let payload: unknown = null;
  let payload_redacted = false;
  try {
    payload = vault.get(row.payload_ref);
  } catch (error) {
    if (error instanceof VaultError) {
      payload_redacted = true;
    } else {
      throw error;
    }
  }
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_ref: row.entity_ref,
    mutation: row.mutation,
    effect_class: row.effect_class,
    precondition: parseJson(row.precondition),
    payload_ref: row.payload_ref,
    payload,
    payload_redacted,
    remote_result: parseJson(row.remote_result),
  };
}

function toSummary(row: ChangesetRow): ChangesetSummary {
  return {
    id: row.id,
    parent_id: row.parent_id,
    hash: row.hash,
    author_kind: row.author_kind,
    author_id: row.author_id,
    agent_meta: parseJson(row.agent_meta),
    rationale: row.rationale,
    status: row.status,
    created_at: row.created_at,
    reviewed_by: row.reviewed_by,
    applied_at: row.applied_at,
    audit: row.audit === 1,
  };
}

function loadChangesetRow(db: SqliteDb, id: string): ChangesetRow {
  const row = db
    .prepare(
      `SELECT ${CHANGESET_COLS} FROM changesets WHERE id = ?`,
    )
    .get(id) as ChangesetRow | undefined;
  if (!row) {
    throw new LedgerError("changeset_not_found");
  }
  return row;
}

export function decideCommitPolicy(
  mutations: Mutation[],
  authorKind: AuthorKind,
  policy: Policy,
  rng: () => number = Math.random,
): { status: ChangesetStatus; reviewed_by: string | null; audit: boolean } {
  const allAuto =
    mutations.length > 0 &&
    mutations.every(
      (mutation) => gateFor(mutation, policy) === "auto" && requiredEffectClass(mutation) === "reversible",
    );
  const sampleRejects =
    authorKind === "agent" && mutations.includes("Reject") && sampleReject(policy, rng);
  return {
    status: allAuto ? "approved" : "staged",
    reviewed_by: allAuto ? "policy" : null,
    audit: sampleRejects,
  };
}

export function commitChangeset(
  db: SqliteDb,
  vault: Vault,
  input: CommitInput,
  options?: CommitPolicyOptions,
): ChangesetDetail {
  const rationale = requireString(input.rationale, "rationale_required");
  const authorId = requireString(input.author_id, "author_id_required");
  const authorKind = input.author_kind ?? "human";
  if (!isAuthorKind(authorKind)) {
    throw new LedgerError("invalid_author_kind");
  }
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new LedgerError("changes_required");
  }

  const agentMeta = input.agent_meta === undefined ? null : input.agent_meta;

  const write = db.transaction(() => {
    const parent = tip(db);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const working = new Map<string, { state: unknown; candidateRef: string }>();
    const prepared: Array<{
      entity_type: EntityType;
      entity_ref: string;
      mutation: Mutation;
      effect_class: EffectClass;
      precondition: unknown;
      payload: unknown;
      candidate_ref: string;
    }> = [];

    for (const change of input.changes) {
      if (!isEntityType(change.entity_type)) {
        throw new LedgerError(`unknown_entity_type: ${change.entity_type}`);
      }
      const entityRef = requireString(change.entity_ref, "entity_ref_required");
      if (!isMutation(change.mutation)) {
        throw new LedgerError(`unknown_mutation: ${change.mutation}`);
      }
      if (!isEffectClass(change.effect_class)) {
        throw new LedgerError(`unknown_effect_class: ${change.effect_class}`);
      }
      const expectedClass = requiredEffectClass(change.mutation);
      if (change.effect_class !== expectedClass) {
        throw new LedgerError(`effect_class_mismatch: ${change.mutation} requires ${expectedClass}`);
      }
      validatePayload(change.mutation, change.payload);

      const key = `${change.entity_type}:${entityRef}`;
      let state: unknown;
      let candidateRef: string;
      const prior = working.get(key);
      if (prior) {
        state = prior.state;
        candidateRef = prior.candidateRef;
      } else {
        const mirror = readMirrorEntity(db, change.entity_type, entityRef);
        if (!mirror) {
          throw new LedgerError(`unknown_entity: ${change.entity_type}:${entityRef}`);
        }
        state = mirror.state;
        candidateRef = candidateRefFor(change.entity_type, entityRef, mirror.state);
      }

      const projection = casProjection(change.entity_type, state);
      if (!projection) {
        throw new LedgerError(`unknown_entity: ${change.entity_type}:${entityRef} state is invalid`);
      }
      if (change.precondition !== undefined) {
        if (isEmptyPrecondition(change.precondition)) {
          throw new LedgerError("empty_precondition");
        }
        if (!matchesPrecondition(projection, change.precondition)) {
          throw new LedgerError(`precondition_mismatch: ${change.entity_type}:${entityRef}`);
        }
      }
      validateTransition(change.mutation, change.entity_type, state, change.payload);

      prepared.push({
        entity_type: change.entity_type,
        entity_ref: entityRef,
        mutation: change.mutation,
        effect_class: change.effect_class,
        precondition: projection,
        payload: change.payload,
        candidate_ref: candidateRef,
      });
      working.set(key, {
        state: nextEntityState(state, change.mutation, change.payload),
        candidateRef,
      });
    }

    const stagedChanges = prepared.map((change) => ({
      change,
      changeId: crypto.randomUUID(),
      payloadRef: vault.put(change.candidate_ref, change.payload),
    }));

    const canonicalChanges: CanonicalChange[] = stagedChanges.map(({ change, payloadRef }) => ({
      entity_type: change.entity_type,
      entity_ref: change.entity_ref,
      mutation: change.mutation,
      effect_class: change.effect_class,
      precondition: change.precondition,
      payload_ref: payloadRef,
      payload_hash: payloadCipherHash(db, payloadRef),
    }));
    const body: CanonicalBody = {
      author_kind: authorKind,
      author_id: authorId,
      agent_meta: agentMeta,
      rationale,
      changes: canonicalChanges,
    };
    const hash = hashChangeset(parent?.hash ?? GENESIS_PARENT_HASH, body);
    const decision = decideCommitPolicy(
      prepared.map((change) => change.mutation),
      authorKind,
      options?.policy ?? failClosedPolicy(),
      options?.rng ?? Math.random,
    );

    try {
      db.prepare(
        "INSERT INTO changesets (id, parent_id, hash, author_kind, author_id, agent_meta, rationale, status, created_at, reviewed_by, applied_at, audit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      ).run(
        id,
        parent?.id ?? null,
        hash,
        authorKind,
        authorId,
        agentMeta === null ? null : JSON.stringify(agentMeta),
        rationale,
        decision.status,
        createdAt,
        decision.reviewed_by,
        decision.audit ? 1 : 0,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) {
        throw new LedgerError("concurrent_commit");
      }
      throw error;
    }

    const inserted: ChangeRow[] = [];
    for (const [seq, item] of stagedChanges.entries()) {
      db.prepare(
        "INSERT INTO changes (id, changeset_id, entity_type, entity_ref, mutation, effect_class, precondition, payload_ref, remote_result, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      ).run(
        item.changeId,
        id,
        item.change.entity_type,
        item.change.entity_ref,
        item.change.mutation,
        item.change.effect_class,
        JSON.stringify(item.change.precondition),
        item.payloadRef,
        seq,
      );
      inserted.push({
        id: item.changeId,
        changeset_id: id,
        entity_type: item.change.entity_type,
        entity_ref: item.change.entity_ref,
        mutation: item.change.mutation,
        effect_class: item.change.effect_class,
        precondition: JSON.stringify(item.change.precondition),
        payload_ref: item.payloadRef,
        remote_result: null,
      });
    }

    return { id, parent, hash, createdAt, inserted, decision };
  });

  const { id, parent, hash, createdAt, inserted, decision } = write();
  return {
    id,
    parent_id: parent?.id ?? null,
    hash,
    author_kind: authorKind,
    author_id: authorId,
    agent_meta: agentMeta,
    rationale,
    status: decision.status,
    created_at: createdAt,
    reviewed_by: decision.reviewed_by,
    applied_at: null,
    audit: decision.audit,
    changes: inserted.map((row) => toChangeRecord(row, vault)),
  };
}

export function listChangesets(db: SqliteDb, status?: ChangesetStatus): ChangesetSummary[] {
  const rows = (
    status
      ? db
          .prepare(
            `SELECT ${CHANGESET_COLS} FROM changesets WHERE status = ? ORDER BY created_at DESC, id DESC`,
          )
          .all(status)
      : db
          .prepare(
            `SELECT ${CHANGESET_COLS} FROM changesets ORDER BY created_at DESC, id DESC`,
          )
          .all()
  ) as ChangesetRow[];
  return rows.map(toSummary);
}

export function getChangeset(db: SqliteDb, vault: Vault, id: string): ChangesetDetail {
  const row = loadChangesetRow(db, id);
  return {
    ...toSummary(row),
    changes: loadChangeRows(db, id).map((change) => toChangeRecord(change, vault)),
  };
}

export function reviewChangeset(
  db: SqliteDb,
  vault: Vault,
  id: string,
  input: { action: string; reviewer_id: string },
): ChangesetDetail {
  const reviewerId = requireString(input.reviewer_id, "reviewer_id_required");
  if (input.action !== "approve" && input.action !== "reject") {
    throw new LedgerError("invalid_review_action");
  }
  const row = loadChangesetRow(db, id);
  if (row.status !== "staged") {
    throw new LedgerError("not_staged");
  }
  const status: ChangesetStatus = input.action === "approve" ? "approved" : "rejected";
  db.prepare("UPDATE changesets SET status = ?, reviewed_by = ? WHERE id = ?").run(status, reviewerId, id);
  return getChangeset(db, vault, id);
}

export function readLog(db: SqliteDb): AuditEntry[] {
  const rows = db
    .prepare(
      "SELECT id, parent_id, hash, status, author_kind, author_id, reviewed_by, rationale, created_at, applied_at, audit FROM changesets ORDER BY created_at ASC, id ASC",
    )
    .all() as Array<{
    id: string;
    parent_id: string | null;
    hash: string;
    status: ChangesetStatus;
    author_kind: AuthorKind;
    author_id: string;
    reviewed_by: string | null;
    rationale: string;
    created_at: number;
    applied_at: number | null;
    audit: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    parent_id: row.parent_id,
    hash: row.hash,
    status: row.status,
    author_kind: row.author_kind,
    author_id: row.author_id,
    reviewed_by: row.reviewed_by,
    rationale: row.rationale,
    created_at: row.created_at,
    applied_at: row.applied_at,
    audit: row.audit === 1,
  }));
}

export function markChangesetStatus(db: SqliteDb, id: string, status: ChangesetStatus, appliedAt?: number): void {
  if (appliedAt !== undefined) {
    db.prepare("UPDATE changesets SET status = ?, applied_at = ? WHERE id = ?").run(status, appliedAt, id);
    return;
  }
  db.prepare("UPDATE changesets SET status = ? WHERE id = ?").run(status, id);
}

export function markChangesetApplied(db: SqliteDb, id: string, appliedAt: number): void {
  const updated = db
    .prepare("UPDATE changesets SET status = 'applied', applied_at = ? WHERE id = ? AND status = 'approved'")
    .run(appliedAt, id);
  if (updated.changes === 0) {
    throw new LedgerError("push_status_conflict");
  }
}

export function setChangeRemoteResult(db: SqliteDb, changeId: string, remoteResult: unknown): void {
  db.prepare("UPDATE changes SET remote_result = ? WHERE id = ?").run(JSON.stringify(remoteResult), changeId);
}

export { loadChangeRows, loadChangesetRow };
