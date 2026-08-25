import type { Application, ApplicationStage, Candidate, Job } from "../domain.ts";
import type { SqlBindings, SqliteDb } from "../db.ts";
import {
  canExitToTerminal,
  isAdvanceStagePayload,
  isAddNotePayload,
  isAddTagPayload,
  isApplication,
  isExtendOfferPayload,
  isLegalAdvanceOnPath,
  isSendOutreachPayload,
} from "../domain.ts";
import { casProjection, isEmptyPrecondition, matchesPrecondition } from "../precondition.ts";
import type { ApplyChange, ApplyResult } from "./types.ts";

/** Fixture-backed adapters share one CAS applier; their tables differ only by prefix. */
export function createChangeApplier(
  db: SqliteDb,
  options: { prefix: string; unknownEntityReason: string; stages?: readonly ApplicationStage[] },
): (change: ApplyChange) => ApplyResult {
  const tables = {
    jobs: `${options.prefix}jobs`,
    candidates: `${options.prefix}candidates`,
    applications: `${options.prefix}applications`,
    notes: `${options.prefix}notes`,
    tags: `${options.prefix}tags`,
    outreach: `${options.prefix}outreach`,
    offers: `${options.prefix}offers`,
  };
  return (change) => {
    const current =
      change.entityType === "application"
        ? readApplication(db, tables.applications, change.entityRef)
        : change.entityType === "candidate"
          ? readCandidate(db, tables.candidates, change.entityRef)
          : change.entityType === "job"
            ? readJob(db, tables.jobs, change.entityRef)
            : undefined;

    if (!current) {
      return { ok: false, reason: options.unknownEntityReason };
    }
    if (isEmptyPrecondition(change.precondition)) {
      return { ok: false, reason: "empty_precondition" };
    }
    const projection = casProjection(change.entityType, current);
    if (!projection || !matchesPrecondition(projection, change.precondition)) {
      return { ok: false, reason: "precondition_failed" };
    }

    switch (change.mutation) {
      case "AdvanceStage": {
        if (change.entityType !== "application" || !isApplication(current) || !isAdvanceStagePayload(change.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!isLegalAdvanceOnPath(current.stage, change.payload.to, options.stages)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, current.stage, change.payload.to);
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...current, stage: change.payload.to } };
      }
      case "Reject": {
        if (change.entityType !== "application" || !isApplication(current)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!canExitToTerminal(current.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, current.stage, "Rejected");
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...current, stage: "Rejected" } };
      }
      case "Withdraw": {
        if (change.entityType !== "application" || !isApplication(current)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!canExitToTerminal(current.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, current.stage, "Withdrawn");
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...current, stage: "Withdrawn" } };
      }
      case "AddNote": {
        if (!isAddNotePayload(change.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO ${tables.notes} (id, entity_type, entity_ref, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, change.entityType, change.entityRef, change.payload.body, Date.now());
        return { ok: true, remoteResult: { noteId: id } };
      }
      case "AddTag": {
        if (!isAddTagPayload(change.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        db.prepare(
          `INSERT OR IGNORE INTO ${tables.tags} (entity_type, entity_ref, tag, created_at) VALUES (?, ?, ?, ?)`,
        ).run(change.entityType, change.entityRef, change.payload.tag, Date.now());
        return { ok: true, remoteResult: { tag: change.payload.tag } };
      }
      case "SendOutreach": {
        if (!isSendOutreachPayload(change.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        const channel = change.payload.channel !== undefined && change.payload.channel.length > 0 ? change.payload.channel : "email";
        db.prepare(
          `INSERT INTO ${tables.outreach} (id, entity_type, entity_ref, channel, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, change.entityType, change.entityRef, channel, change.payload.body, Date.now());
        return { ok: true, remoteResult: { outreachId: id, channel } };
      }
      case "ExtendOffer": {
        if (change.entityType !== "application" || !isExtendOfferPayload(change.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO ${tables.offers} (id, entity_ref, terms, created_at) VALUES (?, ?, ?, ?)`).run(
          id,
          change.entityRef,
          change.payload.terms,
          Date.now(),
        );
        return { ok: true, remoteResult: { offerId: id } };
      }
      default:
        return { ok: false, reason: "unsupported" };
    }
  };
}

function readApplication(db: SqliteDb, table: string, id: string): Application | undefined {
  return (
    db
      .prepare<Application, SqlBindings>(
        `SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM ${table} WHERE id = ?`,
      )
      .get(id) ?? undefined
  );
}

function readCandidate(db: SqliteDb, table: string, id: string): Candidate | undefined {
  return (
    db
      .prepare<Candidate, SqlBindings>(`SELECT id, remote_id AS remoteId, name, email, headline FROM ${table} WHERE id = ?`)
      .get(id) ?? undefined
  );
}

function readJob(db: SqliteDb, table: string, id: string): Job | undefined {
  return (
    db
      .prepare<Job, SqlBindings>(`SELECT id, remote_id AS remoteId, title, team, location, status FROM ${table} WHERE id = ?`)
      .get(id) ?? undefined
  );
}

function casUpdateStage(
  db: SqliteDb,
  table: string,
  id: string,
  from: ApplicationStage,
  to: ApplicationStage,
): ApplyResult {
  const updated = db.prepare(`UPDATE ${table} SET stage = ? WHERE id = ? AND stage = ?`).run(to, id, from);
  if (updated.changes === 0) {
    return { ok: false, reason: "precondition_failed" };
  }
  return { ok: true, remoteResult: undefined };
}
