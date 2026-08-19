import { JOB_STATUSES, isStage, type EntityType } from "./domain.ts";

/** True when every field in `expected` is deeply equal to the same field on `actual`. Extra actual fields are ignored. */
export function matchesPrecondition(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected) || actual === expected;
  }
  if (actual === null || typeof actual !== "object") {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }
    return expected.every((item, index) => matchesPrecondition(actual[index], item));
  }
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expectedRecord)) {
    if (!matchesPrecondition(actualRecord[key], value)) {
      return false;
    }
  }
  return true;
}

export function isEmptyPrecondition(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

/**
 * Non-PII CAS snapshot: ids, stage, job status, remoteId.
 * Never name, email, headline, note body, title, or other descriptive fields.
 */
export function casProjection(entityType: EntityType, state: unknown): Record<string, unknown> | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return undefined;
  }
  const row = state as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.remoteId !== "string") {
    return undefined;
  }
  switch (entityType) {
    case "application":
      if (
        typeof row.jobId !== "string" ||
        typeof row.candidateId !== "string" ||
        typeof row.stage !== "string" ||
        !isStage(row.stage)
      ) {
        return undefined;
      }
      return { id: row.id, remoteId: row.remoteId, stage: row.stage };
    case "job":
      if (typeof row.status !== "string" || !(JOB_STATUSES as readonly string[]).includes(row.status)) {
        return undefined;
      }
      return { id: row.id, remoteId: row.remoteId, status: row.status };
    case "candidate":
      return { id: row.id, remoteId: row.remoteId };
  }
}
