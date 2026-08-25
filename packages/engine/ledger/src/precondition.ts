import {
  isApplication,
  isCandidate,
  isJob,
  type CasField,
  type CasProjection,
  type EntityState,
  type EntityType,
} from "./domain.ts";

/** True when every set field in `expected` matches the same field on `actual`. Extra actual fields are ignored. */
export function matchesPrecondition(actual: CasProjection, expected: CasField): boolean {
  if (expected.id !== undefined && actual.id !== expected.id) return false;
  if (expected.remoteId !== undefined && actual.remoteId !== expected.remoteId) return false;
  if (expected.stage !== undefined) {
    return "stage" in actual && actual.stage === expected.stage;
  }
  if (expected.status !== undefined) {
    return "status" in actual && actual.status === expected.status;
  }
  return true;
}

export function isEmptyPrecondition(value: CasField): boolean {
  return (
    value.id === undefined &&
    value.remoteId === undefined &&
    value.stage === undefined &&
    value.status === undefined
  );
}

/**
 * Non-PII CAS snapshot: ids, stage, job status, remoteId.
 * Never name, email, headline, note body, title, or other descriptive fields.
 */
export function casProjection(entityType: EntityType, state: EntityState): CasProjection | undefined {
  switch (entityType) {
    case "application": {
      if (!isApplication(state)) return undefined;
      return { id: state.id, remoteId: state.remoteId, stage: state.stage };
    }
    case "job": {
      if (!isJob(state)) return undefined;
      return { id: state.id, remoteId: state.remoteId, status: state.status };
    }
    case "candidate": {
      if (!isCandidate(state)) return undefined;
      return { id: state.id, remoteId: state.remoteId };
    }
  }
  return undefined;
}
