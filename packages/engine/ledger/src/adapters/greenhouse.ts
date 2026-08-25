import { readFileSync } from "node:fs";
import type { Application, AtsSnapshot, Candidate, Job } from "../domain.ts";
import type { SqlBindings, SqliteDb } from "../db.ts";
import { parseAtsFixture } from "../domain.ts";
import { parseJsonText } from "../json.ts";
import { createChangeApplier } from "./apply.ts";
import type { AtsAdapter } from "./types.ts";

type CountRow = { n: number };

/** Isolated Greenhouse tables — do not share `schema.ts` / mock ATS tables. */
export function migrateGreenhouse(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS greenhouse_jobs (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      team TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greenhouse_candidates (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      headline TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greenhouse_applications (
      id TEXT PRIMARY KEY,
      remote_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL REFERENCES greenhouse_jobs(id),
      candidate_id TEXT NOT NULL REFERENCES greenhouse_candidates(id),
      stage TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greenhouse_notes (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greenhouse_tags (
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_ref, tag)
    );

    CREATE TABLE IF NOT EXISTS greenhouse_outreach (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_ref TEXT NOT NULL,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greenhouse_offers (
      id TEXT PRIMARY KEY,
      entity_ref TEXT NOT NULL,
      terms TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function seedGreenhouse(db: SqliteDb, fixturePath: string): boolean {
  const count = db.prepare<CountRow, SqlBindings>("SELECT COUNT(*) AS n FROM greenhouse_jobs").get();
  if (count && count.n > 0) {
    return false;
  }

  const fixture = parseAtsFixture(parseJsonText(readFileSync(fixturePath, "utf8")));
  const insertJob = db.prepare(
    "INSERT INTO greenhouse_jobs (id, remote_id, title, team, location, status) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertCandidate = db.prepare(
    "INSERT INTO greenhouse_candidates (id, remote_id, name, email, headline) VALUES (?, ?, ?, ?, ?)",
  );
  const insertApplication = db.prepare(
    "INSERT INTO greenhouse_applications (id, remote_id, job_id, candidate_id, stage) VALUES (?, ?, ?, ?, ?)",
  );

  const seed = db.transaction(() => {
    for (const job of fixture.jobs) {
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

export function createGreenhouseAdapter(db: SqliteDb, options: { fixturePath: string }): AtsAdapter {
  const applyChange = createChangeApplier(db, {
    prefix: "greenhouse_",
    unknownEntityReason: "unsupported",
  });
  return {
    id: "greenhouse",
    prepare() {
      return { seeded: seedGreenhouse(db, options.fixturePath) };
    },
    pull(): AtsSnapshot {
      const jobs = db
        .prepare<Job, SqlBindings>("SELECT id, remote_id AS remoteId, title, team, location, status FROM greenhouse_jobs")
        .all();
      const candidates = db
        .prepare<Candidate, SqlBindings>("SELECT id, remote_id AS remoteId, name, email, headline FROM greenhouse_candidates")
        .all();
      const applications = db
        .prepare<Application, SqlBindings>(
          "SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM greenhouse_applications",
        )
        .all();

      return { ats: "greenhouse", jobs, candidates, applications };
    },
    apply(change) {
      return applyChange(change);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
