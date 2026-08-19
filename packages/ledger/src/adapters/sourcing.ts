export type SourcedCandidate = {
  id: string;
  name: string;
  headline: string;
  source: string;
  score?: number;
};

export type SourcingQuery = {
  role: string;
  limit?: number;
};

/** External sourcing system. Juicebox implements this, either as the fixture adapter or live over MCP. */
export type SourcingAdapter = {
  id: "juicebox";
  /** Optional setup before search. Mock uses this to seed; real adapters omit it. */
  prepare?(): { seeded: boolean };
  search(query: SourcingQuery): SourcedCandidate[];
  /** Optional teardown for adapters holding a live connection (MCP). */
  close?(): void;
};
