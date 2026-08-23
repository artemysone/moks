import type { Application, ApplicationStage, Candidate, Job } from "../domain.ts";
import type { SqliteDb } from "../db.ts";
import { canExitToTerminal, isLegalAdvanceOnPath, isStage } from "../domain.ts";
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

    const payload = payloadRecord(change.payload);

    switch (change.mutation) {
      case "AdvanceStage": {
        if (change.entityType !== "application") {
          return { ok: false, reason: "unsupported" };
        }
        const application = current as Application;
        if (typeof payload.to !== "string" || !isStage(payload.to)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!isLegalAdvanceOnPath(application.stage, payload.to, options.stages)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, application.stage, payload.to);
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...application, stage: payload.to } };
      }
      case "Reject": {
        if (change.entityType !== "application") {
          return { ok: false, reason: "unsupported" };
        }
        const application = current as Application;
        if (!canExitToTerminal(application.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, application.stage, "Rejected");
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...application, stage: "Rejected" } };
      }
      case "Withdraw": {
        if (change.entityType !== "application") {
          return { ok: false, reason: "unsupported" };
        }
        const application = current as Application;
        if (!canExitToTerminal(application.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        const written = casUpdateStage(db, tables.applications, change.entityRef, application.stage, "Withdrawn");
        if (!written.ok) {
          return written;
        }
        return { ok: true, remoteResult: { ...application, stage: "Withdrawn" } };
      }
      case "AddNote": {
        if (typeof payload.body !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO ${tables.notes} (id, entity_type, entity_ref, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, change.entityType, change.entityRef, payload.body, Date.now());
        return { ok: true, remoteResult: { noteId: id } };
      }
      case "AddTag": {
        if (typeof payload.tag !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        db.prepare(
          `INSERT OR IGNORE INTO ${tables.tags} (entity_type, entity_ref, tag, created_at) VALUES (?, ?, ?, ?)`,
        ).run(change.entityType, change.entityRef, payload.tag, Date.now());
        return { ok: true, remoteResult: { tag: payload.tag } };
      }
      case "SendOutreach": {
        if (typeof payload.body !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        const channel = typeof payload.channel === "string" && payload.channel.length > 0 ? payload.channel : "email";
        db.prepare(
          `INSERT INTO ${tables.outreach} (id, entity_type, entity_ref, channel, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, change.entityType, change.entityRef, channel, payload.body, Date.now());
        return { ok: true, remoteResult: { outreachId: id, channel } };
      }
      case "ExtendOffer": {
        if (change.entityType !== "application" || typeof payload.terms !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO ${tables.offers} (id, entity_ref, terms, created_at) VALUES (?, ?, ?, ?)`).run(
          id,
          change.entityRef,
          payload.terms,
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
  return db
    .prepare(
      `SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM ${table} WHERE id = ?`,
    )
    .get(id) as Application | undefined;
}

function readCandidate(db: SqliteDb, table: string, id: string): Candidate | undefined {
  return db
    .prepare(`SELECT id, remote_id AS remoteId, name, email, headline FROM ${table} WHERE id = ?`)
    .get(id) as Candidate | undefined;
}

function readJob(db: SqliteDb, table: string, id: string): Job | undefined {
  return db
    .prepare(`SELECT id, remote_id AS remoteId, title, team, location, status FROM ${table} WHERE id = ?`)
    .get(id) as Job | undefined;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
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
