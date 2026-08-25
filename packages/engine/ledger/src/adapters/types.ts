import type { AtsSnapshot, CasField, EntityType, Mutation, MutationPayload, RemoteResult } from "../domain.ts";

export type ApplyChange = {
  entityType: EntityType;
  entityRef: string;
  mutation: Mutation;
  precondition: CasField;
  payload: MutationPayload;
  idempotencyKey?: string;
};

export type ApplyOk = { ok: true; remoteResult: RemoteResult | undefined };
export type ApplyFail = { ok: false; reason: string };
export type ApplyResult = ApplyOk | ApplyFail;

/** Foreign system of record. Ashby / Greenhouse implement this later. */
export type AtsAdapter = {
  id: AtsSnapshot["ats"];
  /** Optional setup before pull. Mock uses this to seed; real adapters omit it. */
  prepare?(): { seeded: boolean };
  pull(): AtsSnapshot;
  apply(change: ApplyChange): ApplyResult;
  /** Optional write transaction. Mock uses this so a failed changeset rolls back ATS writes. */
  transaction?<T>(fn: () => T): T;
  /** Optional teardown for adapters holding a live connection (MCP). */
  close?(): void;
};
