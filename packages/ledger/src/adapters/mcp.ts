import type { McpServerConfig } from "../config.ts";
import {
  JOB_STATUSES,
  isStage,
  type Application,
  type AtsId,
  type AtsSnapshot,
  type Candidate,
  type Job,
} from "../domain.ts";
import { McpError } from "../mcp/errors.ts";
import { openSyncMcpClient, type SyncMcpClient } from "../mcp/sync-client.ts";
import { MCP_TOOL_ATS_APPLY, MCP_TOOL_ATS_SNAPSHOT, MCP_TOOL_SOURCE_SEARCH } from "../mcp/types.ts";
import type { SourcedCandidate, SourcingAdapter, SourcingQuery } from "./sourcing.ts";
import type { ApplyChange, ApplyResult, AtsAdapter } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isStringField(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof record[key] === "string");
}

function parseSnapshot(value: unknown, expectedAts: AtsId): AtsSnapshot {
  const record = asRecord(value);
  if (
    !record ||
    !Array.isArray(record.jobs) ||
    !Array.isArray(record.candidates) ||
    !Array.isArray(record.applications)
  ) {
    throw new McpError("mcp_bad_response", "ats_snapshot must return { ats, jobs, candidates, applications }");
  }
  if (record.ats !== expectedAts) {
    throw new McpError("mcp_bad_response", `ats_snapshot ats must be ${expectedAts}, got ${String(record.ats)}`);
  }
  for (const job of record.jobs) {
    const row = asRecord(job);
    if (
      !row ||
      !isStringField(row, ["id", "remoteId", "title", "team", "location", "status"]) ||
      !(JOB_STATUSES as readonly string[]).includes(row.status as string)
    ) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed job");
    }
  }
  for (const candidate of record.candidates) {
    const row = asRecord(candidate);
    if (!row || !isStringField(row, ["id", "remoteId", "name", "email", "headline"])) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed candidate");
    }
  }
  for (const application of record.applications) {
    const row = asRecord(application);
    if (
      !row ||
      !isStringField(row, ["id", "remoteId", "jobId", "candidateId", "stage"]) ||
      !isStage(row.stage as string)
    ) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed application");
    }
  }
  return {
    ats: expectedAts,
    jobs: record.jobs as Job[],
    candidates: record.candidates as Candidate[],
    applications: record.applications as Application[],
  };
}

function parseApplyResult(value: unknown): ApplyResult {
  const record = asRecord(value);
  if (record && record.ok === true) {
    return { ok: true, remoteResult: record.remoteResult };
  }
  if (record && record.ok === false && typeof record.reason === "string") {
    return { ok: false, reason: record.reason };
  }
  throw new McpError("mcp_bad_response", "ats_apply must return { ok: true, remoteResult } or { ok: false, reason }");
}

function parseSourcedCandidates(value: unknown): SourcedCandidate[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.candidates)) {
    throw new McpError("mcp_bad_response", "source_search must return { candidates }");
  }
  return record.candidates.map((candidate) => {
    const row = asRecord(candidate);
    if (!row || !isStringField(row, ["id", "name", "headline", "source"])) {
      throw new McpError("mcp_bad_response", "source_search returned a malformed candidate");
    }
    const sourced: SourcedCandidate = {
      id: row.id as string,
      name: row.name as string,
      headline: row.headline as string,
      source: row.source as string,
    };
    if (typeof row.score === "number") {
      sourced.score = row.score;
    }
    return sourced;
  });
}

/** ATS backed by an MCP server implementing `ats_snapshot` / `ats_apply` (Mox MCP ATS contract). */
export function createMcpAtsAdapter(config: McpServerConfig, options: { id: AtsId }): AtsAdapter {
  const client: SyncMcpClient = openSyncMcpClient(config);
  return {
    id: options.id,
    pull(): AtsSnapshot {
      return parseSnapshot(client.callTool(MCP_TOOL_ATS_SNAPSHOT, {}), options.id);
    },
    apply(change: ApplyChange): ApplyResult {
      // sync.ts attaches a per-change idempotency key so the server can dedupe
      // replayed applies (operator re-push after a timeout, rebase of a
      // partially applied changeset).
      const { idempotencyKey } = change as ApplyChange & { idempotencyKey?: unknown };
      return parseApplyResult(
        client.callTool(MCP_TOOL_ATS_APPLY, {
          entityType: change.entityType,
          entityRef: change.entityRef,
          mutation: change.mutation,
          precondition: change.precondition,
          payload: change.payload,
          ...(typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? { idempotencyKey } : {}),
        }),
      );
    },
    close() {
      client.close();
    },
  };
}

/** Sourcing backed by an MCP server implementing `source_search` (live Juicebox seam). */
export function createMcpSourcingAdapter(config: McpServerConfig): SourcingAdapter {
  const client: SyncMcpClient = openSyncMcpClient(config);
  return {
    id: "juicebox",
    search(query: SourcingQuery): SourcedCandidate[] {
      return parseSourcedCandidates(
        client.callTool(MCP_TOOL_SOURCE_SEARCH, {
          role: query.role,
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
        }),
      );
    },
    close() {
      client.close();
    },
  };
}
