import type { SqlBindings, SqliteDb } from "./db.ts";
import {
  isApplication,
  isCandidate,
  isJob,
  parseApplication,
  parseCandidate,
  parseEntityState,
  parseJob,
  type Application,
  type ApplicationStage,
  type Candidate,
  type EntityState,
  type EntityType,
  type Job,
} from "./domain.ts";
import { LedgerError } from "./errors.ts";
import { parseJsonText } from "./json.ts";

export type MirrorRow = {
  entity_type: EntityType;
  entity_ref: string;
  ats: string;
  remote_id: string;
  state: EntityState;
  synced_at: number;
};

type MirrorSqlRow = {
  entity_type: EntityType;
  entity_ref: string;
  ats: string;
  remote_id: string;
  state: string;
  synced_at: number;
};

type MirrorStateRow = { entity_ref: string; remote_id: string; state: string };
type MirrorEntityRow = { entity_ref: string; state: string };

export function readMirrorEntity(db: SqliteDb, entityType: EntityType, entityRef: string): MirrorRow | undefined {
  const row = db
    .prepare<MirrorSqlRow, SqlBindings>(
      "SELECT entity_type, entity_ref, ats, remote_id, state, synced_at FROM remote_mirror WHERE entity_type = ? AND entity_ref = ?",
    )
    .get(entityType, entityRef);
  if (!row) {
    return undefined;
  }
  const state = parseEntityState(entityType, parseJsonText(row.state));
  if (!state) {
    return undefined;
  }
  return {
    entity_type: row.entity_type,
    entity_ref: row.entity_ref,
    ats: row.ats,
    remote_id: row.remote_id,
    state,
    synced_at: row.synced_at,
  };
}

export function asApplication(state: EntityState): Application | undefined {
  return isApplication(state) ? state : undefined;
}

export function asCandidate(state: EntityState): Candidate | undefined {
  return isCandidate(state) ? state : undefined;
}

export function asJob(state: EntityState): Job | undefined {
  return isJob(state) ? state : undefined;
}

export type ApplicationListing = {
  id: string;
  remoteId: string;
  jobId: string;
  jobTitle: string | null;
  candidateId: string;
  candidateName: string | null;
  candidateHeadline: string | null;
  stage: ApplicationStage;
};

export function listApplications(db: SqliteDb, jobRef?: string | null): ApplicationListing[] {
  const applications = db
    .prepare<MirrorStateRow, SqlBindings>(
      "SELECT entity_ref, remote_id, state FROM remote_mirror WHERE entity_type = 'application' ORDER BY entity_ref ASC",
    )
    .all();
  const candidates = new Map<string, Candidate>();
  const jobs = new Map<string, Job>();
  for (const row of db
    .prepare<MirrorEntityRow, SqlBindings>("SELECT entity_ref, state FROM remote_mirror WHERE entity_type = 'candidate'")
    .all()) {
    const candidate = parseCandidate(parseJsonText(row.state));
    if (candidate) {
      candidates.set(row.entity_ref, candidate);
    }
  }
  for (const row of db
    .prepare<MirrorEntityRow, SqlBindings>("SELECT entity_ref, state FROM remote_mirror WHERE entity_type = 'job'")
    .all()) {
    const job = parseJob(parseJsonText(row.state));
    if (job) {
      jobs.set(row.entity_ref, job);
    }
  }

  const listings: ApplicationListing[] = [];
  for (const row of applications) {
    const application = parseApplication(parseJsonText(row.state));
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

export function candidateRefFor(entityType: EntityType, entityRef: string, state: EntityState | undefined): string {
  if (entityType === "candidate") {
    return entityRef;
  }
  if (entityType === "application") {
    if (!state || !isApplication(state) || state.candidateId.length === 0) {
      throw new LedgerError("unknown_entity: application is missing candidateId");
    }
    return state.candidateId;
  }
  if (entityType === "job") {
    return "_workspace";
  }
  throw new LedgerError(`unknown_entity_type: ${entityType}`);
}
