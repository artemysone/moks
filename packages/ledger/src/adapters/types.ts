import type { EntityType, Mutation } from "../domain.ts";
import type { AtsSnapshot } from "../domain.ts";

export type ApplyChange = {
  entityType: EntityType;
  entityRef: string;
  mutation: Mutation;
  precondition: unknown;
  payload: unknown;
};

export type ApplyResult =
  | { ok: true; remoteResult: unknown }
  | { ok: false; reason: "precondition_failed" | "unsupported" | string };

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
