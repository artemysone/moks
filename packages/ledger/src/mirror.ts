import type { SqliteDb } from "./db.ts";
import type { Application, Candidate, EntityType, Job } from "./domain.ts";
import { isStage } from "./domain.ts";
import { LedgerError } from "./errors.ts";

export type MirrorRow = {
  entity_type: EntityType;
  entity_ref: string;
  ats: string;
  remote_id: string;
  state: unknown;
  synced_at: number;
};

export function readMirrorEntity(db: SqliteDb, entityType: EntityType, entityRef: string): MirrorRow | undefined {
  const row = db
    .prepare(
      "SELECT entity_type, entity_ref, ats, remote_id, state, synced_at FROM remote_mirror WHERE entity_type = ? AND entity_ref = ?",
    )
    .get(entityType, entityRef) as
    | { entity_type: EntityType; entity_ref: string; ats: string; remote_id: string; state: string; synced_at: number }
    | undefined;
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    state: JSON.parse(row.state) as unknown,
  };
}

export function asApplication(state: unknown): Application | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }
  const row = state as Partial<Application>;
  if (
    typeof row.id !== "string" ||
    typeof row.remoteId !== "string" ||
    typeof row.jobId !== "string" ||
    typeof row.candidateId !== "string" ||
    typeof row.stage !== "string" ||
    !isStage(row.stage)
  ) {
    return undefined;
  }
  return row as Application;
}

export function asCandidate(state: unknown): Candidate | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }
  const row = state as Partial<Candidate>;
  if (
    typeof row.id !== "string" ||
    typeof row.remoteId !== "string" ||
    typeof row.name !== "string" ||
    typeof row.email !== "string" ||
    typeof row.headline !== "string"
  ) {
    return undefined;
  }
  return row as Candidate;
}

export function asJob(state: unknown): Job | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }
  const row = state as Partial<Job>;
  if (typeof row.id !== "string") {
    return undefined;
  }
  return row as Job;
}

export type ApplicationListing = {
  id: string;
  remoteId: string;
  jobId: string;
  jobTitle: string | null;
  candidateId: string;
  candidateName: string | null;
  candidateHeadline: string | null;
  stage: string;
};

export function listApplications(db: SqliteDb, jobRef?: string | null): ApplicationListing[] {
  const applications = db
    .prepare(
      "SELECT entity_ref, remote_id, state FROM remote_mirror WHERE entity_type = 'application' ORDER BY entity_ref ASC",
    )
    .all() as Array<{ entity_ref: string; remote_id: string; state: string }>;
  const candidates = new Map<string, Candidate>();
  const jobs = new Map<string, Job>();
  for (const row of db
    .prepare("SELECT entity_ref, state FROM remote_mirror WHERE entity_type = 'candidate'")
    .all() as Array<{ entity_ref: string; state: string }>) {
    const candidate = asCandidate(JSON.parse(row.state) as unknown);
    if (candidate) {
      candidates.set(row.entity_ref, candidate);
    }
  }
  for (const row of db
    .prepare("SELECT entity_ref, state FROM remote_mirror WHERE entity_type = 'job'")
    .all() as Array<{ entity_ref: string; state: string }>) {
    const job = asJob(JSON.parse(row.state) as unknown);
    if (job) {
      jobs.set(row.entity_ref, job);
    }
  }

  const listings: ApplicationListing[] = [];
  for (const row of applications) {
    const application = asApplication(JSON.parse(row.state) as unknown);
    if (!application) {
      continue;
    }
    const candidate = candidates.get(application.candidateId);
    const job = jobs.get(application.jobId);
    listings.push({
      id: application.id,
      remoteId: application.remoteId,
      jobId: application.jobId,
      jobTitle: job?.title ?? null,
      candidateId: application.candidateId,
      candidateName: candidate?.name ?? null,
      candidateHeadline: candidate?.headline ?? null,
      stage: application.stage,
    });
  }
  if (jobRef) {
    return listings.filter((listing) => listing.jobId === jobRef);
  }
  return listings;
}

export function candidateRefFor(entityType: EntityType, entityRef: string, state: unknown): string {
  if (entityType === "candidate") {
    return entityRef;
  }
  if (entityType === "application") {
    const application = asApplication(state);
    if (!application || application.candidateId.length === 0) {
      throw new LedgerError("unknown_entity: application is missing candidateId");
    }
    return application.candidateId;
  }
  if (entityType === "job") {
    return "_workspace";
  }
  throw new LedgerError(`unknown_entity_type: ${entityType}`);
}
