import { readFileSync } from "node:fs";
import type { Application, ApplicationStage, AtsSnapshot, Candidate, Job, JobStatus } from "../domain.ts";
import type { SqliteDb } from "../db.ts";
import { JOB_STATUSES, canExitToTerminal, isLegalAdvance, isStage } from "../domain.ts";
import { casProjection, isEmptyPrecondition, matchesPrecondition } from "../precondition.ts";
import type { ApplyChange, ApplyResult, AtsAdapter } from "./types.ts";

type FixtureFile = {
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
};

function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

export function seedMockAts(db: SqliteDb, fixturePath: string): boolean {
  const count = db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number };
  if (count.n > 0) {
    return false;
  }

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;
  const insertJob = db.prepare(
    "INSERT INTO jobs (id, remote_id, title, team, location, status) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertCandidate = db.prepare(
    "INSERT INTO candidates (id, remote_id, name, email, headline) VALUES (?, ?, ?, ?, ?)",
  );
  const insertApplication = db.prepare(
    "INSERT INTO applications (id, remote_id, job_id, candidate_id, stage) VALUES (?, ?, ?, ?, ?)",
  );

  const seed = db.transaction(() => {
    for (const job of fixture.jobs) {
      if (!isJobStatus(job.status)) {
        throw new Error(`Invalid fixture job status: ${job.status}`);
      }
      insertJob.run(job.id, job.remoteId, job.title, job.team, job.location, job.status);
    }
    for (const candidate of fixture.candidates) {
      insertCandidate.run(
        candidate.id,
        candidate.remoteId,
        candidate.name,
        candidate.email,
        candidate.headline,
      );
    }
    for (const application of fixture.applications) {
      if (!isStage(application.stage)) {
        throw new Error(`Invalid fixture stage: ${application.stage}`);
      }
      insertApplication.run(
        application.id,
        application.remoteId,
        application.jobId,
        application.candidateId,
        application.stage,
      );
    }
  });
  seed();

  return true;
}

export function createMockAdapter(db: SqliteDb, options: { fixturePath: string }): AtsAdapter {
  return {
    id: "mock",
    prepare() {
      return { seeded: seedMockAts(db, options.fixturePath) };
    },
    pull(): AtsSnapshot {
      const jobs = db
        .prepare("SELECT id, remote_id AS remoteId, title, team, location, status FROM jobs")
        .all() as Job[];
      const candidates = db
        .prepare("SELECT id, remote_id AS remoteId, name, email, headline FROM candidates")
        .all() as Candidate[];
      const applications = db
        .prepare(
          "SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM applications",
        )
        .all() as Application[];

      return { ats: "mock", jobs, candidates, applications };
    },
    apply(change) {
      return applyMockChange(db, change);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}

function readApplication(db: SqliteDb, id: string): Application | undefined {
  return db
    .prepare(
      "SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM applications WHERE id = ?",
    )
    .get(id) as Application | undefined;
}

function readCandidate(db: SqliteDb, id: string): Candidate | undefined {
  return db
    .prepare("SELECT id, remote_id AS remoteId, name, email, headline FROM candidates WHERE id = ?")
    .get(id) as Candidate | undefined;
}

function readJob(db: SqliteDb, id: string): Job | undefined {
  return db
    .prepare("SELECT id, remote_id AS remoteId, title, team, location, status FROM jobs WHERE id = ?")
    .get(id) as Job | undefined;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function casUpdateStage(db: SqliteDb, id: string, from: ApplicationStage, to: ApplicationStage): ApplyResult {
  const updated = db.prepare("UPDATE applications SET stage = ? WHERE id = ? AND stage = ?").run(to, id, from);
  if (updated.changes === 0) {
    return { ok: false, reason: "precondition_failed" };
  }
  return { ok: true, remoteResult: undefined };
}

export function applyMockChange(db: SqliteDb, change: ApplyChange): ApplyResult {
  const current =
    change.entityType === "application"
      ? readApplication(db, change.entityRef)
      : change.entityType === "candidate"
        ? readCandidate(db, change.entityRef)
        : change.entityType === "job"
          ? readJob(db, change.entityRef)
          : undefined;

  if (!current) {
    return { ok: false, reason: "unknown_entity" };
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
      if (!isLegalAdvance(application.stage, payload.to)) {
        return { ok: false, reason: "illegal_transition" };
      }
      const written = casUpdateStage(db, change.entityRef, application.stage, payload.to);
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
      const written = casUpdateStage(db, change.entityRef, application.stage, "Rejected");
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
      const written = casUpdateStage(db, change.entityRef, application.stage, "Withdrawn");
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
      db.prepare("INSERT INTO notes (id, entity_type, entity_ref, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        change.entityType,
        change.entityRef,
        payload.body,
        Date.now(),
      );
      return { ok: true, remoteResult: { noteId: id } };
    }
    case "AddTag": {
      if (typeof payload.tag !== "string") {
        return { ok: false, reason: "unsupported" };
      }
      db.prepare(
        "INSERT OR IGNORE INTO tags (entity_type, entity_ref, tag, created_at) VALUES (?, ?, ?, ?)",
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
        "INSERT INTO outreach (id, entity_type, entity_ref, channel, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, change.entityType, change.entityRef, channel, payload.body, Date.now());
      return { ok: true, remoteResult: { outreachId: id, channel } };
    }
    case "ExtendOffer": {
      if (change.entityType !== "application" || typeof payload.terms !== "string") {
        return { ok: false, reason: "unsupported" };
      }
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO offers (id, entity_ref, terms, created_at) VALUES (?, ?, ?, ?)").run(
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
}
