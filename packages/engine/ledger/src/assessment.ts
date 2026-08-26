import type { SqlBindings, SqliteDb } from "./db.ts";
import { LedgerError } from "./errors.ts";
import { isJsonObject, jsonNumber, jsonString, parseJsonText, type Json } from "./json.ts";

export type AssessmentDimension = {
  label: string;
  score: number | null;
  evidence: string;
  source_path: string;
};

export type Assessment = {
  id: string;
  reqRef: string;
  candidateId: string;
  scorecardHash: string;
  overall: number | null;
  recommendation: string;
  dimensions: AssessmentDimension[];
  createdAt: number;
  changesetId: string | null;
};

export type ReqJob = {
  reqSlug: string;
  jobId: string | null;
  title: string;
  createdAt: number;
};

export type SaveAssessmentInput = {
  id?: string;
  reqRef: string;
  candidateId: string;
  scorecardHash: string;
  overall: number | null;
  recommendation: string;
  dimensions: AssessmentDimension[];
  createdAt?: number;
  changesetId?: string | null;
};

type AssessmentRow = {
  id: string;
  req_ref: string;
  candidate_id: string;
  scorecard_hash: string;
  overall: number | null;
  recommendation: string;
  dimensions: string;
  created_at: number;
  changeset_id: string | null;
};

type ReqJobRow = {
  req_slug: string;
  job_id: string | null;
  title: string | null;
  created_at: number;
};

const ASSESSMENT_COLS =
  "id, req_ref, candidate_id, scorecard_hash, overall, recommendation, dimensions, created_at, changeset_id";

function requireString(value: string, message: string): string {
  if (value.trim().length === 0) {
    throw new LedgerError(message);
  }
  return value;
}

function parseDimension(input: Json): AssessmentDimension {
  if (!isJsonObject(input)) {
    throw new LedgerError("invalid_dimensions");
  }
  const label = jsonString(input.label);
  const evidence = jsonString(input.evidence);
  const sourcePath = jsonString(input.source_path);
  if (label === undefined || evidence === undefined || sourcePath === undefined) {
    throw new LedgerError("invalid_dimensions");
  }
  if (input.score === null) {
    return { label, score: null, evidence, source_path: sourcePath };
  }
  const score = jsonNumber(input.score);
  if (score === undefined) {
    throw new LedgerError("invalid_dimensions");
  }
  return { label, score, evidence, source_path: sourcePath };
}

function parseDimensionsJson(text: string): AssessmentDimension[] {
  const parsed = parseJsonText(text);
  if (!Array.isArray(parsed)) {
    throw new LedgerError("invalid_dimensions");
  }
  return parsed.map(parseDimension);
}

function toAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    reqRef: row.req_ref,
    candidateId: row.candidate_id,
    scorecardHash: row.scorecard_hash,
    overall: row.overall,
    recommendation: row.recommendation,
    dimensions: parseDimensionsJson(row.dimensions),
    createdAt: row.created_at,
    changesetId: row.changeset_id,
  };
}

export function saveAssessment(db: SqliteDb, input: SaveAssessmentInput): Assessment {
  const reqRef = requireString(input.reqRef, "req_ref_required");
  const candidateId = requireString(input.candidateId, "candidate_id_required");
  const id = input.id !== undefined && input.id.trim().length > 0 ? input.id : crypto.randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  const changesetId = input.changesetId == null || input.changesetId.length === 0 ? null : input.changesetId;
  db.prepare(
    `INSERT INTO assessments (${ASSESSMENT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    reqRef,
    candidateId,
    input.scorecardHash,
    input.overall,
    input.recommendation,
    JSON.stringify(input.dimensions),
    createdAt,
    changesetId,
  );
  return {
    id,
    reqRef,
    candidateId,
    scorecardHash: input.scorecardHash,
    overall: input.overall,
    recommendation: input.recommendation,
    dimensions: input.dimensions,
    createdAt,
    changesetId,
  };
}

export function getAssessment(db: SqliteDb, id: string): Assessment | undefined {
  const assessmentId = requireString(id, "assessment_id_required");
  const row = db
    .prepare<AssessmentRow, SqlBindings>(`SELECT ${ASSESSMENT_COLS} FROM assessments WHERE id = ?`)
    .get(assessmentId);
  if (row == null) return undefined;
  return toAssessment(row);
}

export function listAssessments(
  db: SqliteDb,
  filter: { reqRef: string; candidateId?: string },
): Assessment[] {
  const reqRef = requireString(filter.reqRef, "req_ref_required");
  if (filter.candidateId !== undefined) {
    const candidateId = requireString(filter.candidateId, "candidate_id_required");
    return db
      .prepare<AssessmentRow, SqlBindings>(
        `SELECT ${ASSESSMENT_COLS} FROM assessments WHERE req_ref = ? AND candidate_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(reqRef, candidateId)
      .map(toAssessment);
  }
  return db
    .prepare<AssessmentRow, SqlBindings>(
      `SELECT ${ASSESSMENT_COLS} FROM assessments WHERE req_ref = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(reqRef)
    .map(toAssessment);
}

export function latestAssessment(
  db: SqliteDb,
  filter: { reqRef: string; candidateId: string },
): Assessment | undefined {
  const reqRef = requireString(filter.reqRef, "req_ref_required");
  const candidateId = requireString(filter.candidateId, "candidate_id_required");
  const row = db
    .prepare<AssessmentRow, SqlBindings>(
      `SELECT ${ASSESSMENT_COLS} FROM assessments WHERE req_ref = ? AND candidate_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(reqRef, candidateId);
  if (row == null) return undefined;
  return toAssessment(row);
}

export function bindReqJob(
  db: SqliteDb,
  input: { reqSlug: string; jobId: string | null; title: string },
): ReqJob {
  const reqSlug = requireString(input.reqSlug, "req_slug_required");
  const jobId = input.jobId === null || input.jobId.trim().length === 0 ? null : input.jobId;
  const existing = getReqJob(db, reqSlug);
  const createdAt = existing === undefined ? Date.now() : existing.createdAt;
  db.prepare(
    `INSERT INTO req_jobs (req_slug, job_id, title, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(req_slug) DO UPDATE SET job_id = excluded.job_id, title = excluded.title`,
  ).run(reqSlug, jobId, input.title, createdAt);
  return { reqSlug, jobId, title: input.title, createdAt };
}

export function getReqJob(db: SqliteDb, reqSlug: string): ReqJob | undefined {
  const slug = requireString(reqSlug, "req_slug_required");
  const row = db
    .prepare<ReqJobRow, SqlBindings>("SELECT req_slug, job_id, title, created_at FROM req_jobs WHERE req_slug = ?")
    .get(slug);
  if (row == null) return undefined;
  return {
    reqSlug: row.req_slug,
    jobId: row.job_id,
    title: row.title ?? "",
    createdAt: row.created_at,
  };
}
