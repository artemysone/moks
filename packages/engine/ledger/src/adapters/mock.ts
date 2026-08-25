import { readFileSync } from "node:fs";
import type { Application, ApplicationStage, AtsSnapshot, Candidate, Job } from "../domain.ts";
import type { SqlBindings, SqliteDb } from "../db.ts";
import { parseAtsFixture } from "../domain.ts";
import { parseJsonText } from "../json.ts";
import { createChangeApplier } from "./apply.ts";
import type { AtsAdapter } from "./types.ts";

type CountRow = { n: number };

export function seedMockAts(db: SqliteDb, fixturePath: string): boolean {
  const count = db.prepare<CountRow, SqlBindings>("SELECT COUNT(*) AS n FROM jobs").get();
  if (count && count.n > 0) {
    return false;
  }

  const fixture = parseAtsFixture(parseJsonText(readFileSync(fixturePath, "utf8")));
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
      insertJob.run(job.id, job.remoteId, job.title, job.team, job.location, job.status);
    }
    for (const candidate of fixture.candidates) {
      insertCandidate.run(candidate.id, candidate.remoteId, candidate.name, candidate.email, candidate.headline);
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

export function createMockAdapter(
  db: SqliteDb,
  options: { fixturePath: string; stages?: readonly ApplicationStage[] },
): AtsAdapter {
  const applyChange = createChangeApplier(db, {
    prefix: "",
    unknownEntityReason: "unknown_entity",
    stages: options.stages,
  });
  return {
    id: "mock",
    prepare() {
      return { seeded: seedMockAts(db, options.fixturePath) };
    },
    pull(): AtsSnapshot {
      const jobs = db.prepare<Job, SqlBindings>("SELECT id, remote_id AS remoteId, title, team, location, status FROM jobs").all();
      const candidates = db
        .prepare<Candidate, SqlBindings>("SELECT id, remote_id AS remoteId, name, email, headline FROM candidates")
        .all();
      const applications = db
        .prepare<Application, SqlBindings>(
          "SELECT id, remote_id AS remoteId, job_id AS jobId, candidate_id AS candidateId, stage FROM applications",
        )
        .all();

      return { ats: "mock", jobs, candidates, applications };
    },
    apply(change) {
      return applyChange(change);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
