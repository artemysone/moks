import { readFileSync } from "node:fs";
import type { Application, ApplicationStage, AtsSnapshot, Candidate, Job, JobStatus } from "../domain.ts";
import type { SqliteDb } from "../db.ts";
import { JOB_STATUSES, isStage } from "../domain.ts";
import { createChangeApplier } from "./apply.ts";
import type { AtsAdapter } from "./types.ts";

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
      return applyChange(change);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}
