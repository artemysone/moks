import type { McpServerConfig } from "../config.ts";
import {
  parseApplication,
  parseAtsId,
  parseCandidate,
  parseJob,
  parseRemoteResult,
  type AtsId,
  type AtsSnapshot,
  type Job,
  type Candidate,
  type Application,
} from "../domain.ts";
import { isJsonObject, isJsonString, jsonNumber, jsonString, parseJsonText, type Json } from "../json.ts";
import { McpError } from "../mcp/errors.ts";
import { openSyncMcpClient, type SyncMcpClient } from "../mcp/sync-client.ts";
import { MCP_TOOL_ATS_APPLY, MCP_TOOL_ATS_SNAPSHOT, MCP_TOOL_SOURCE_SEARCH, type AtsApplyArgs, type SourceSearchArgs } from "../mcp/types.ts";
import type { SourcedCandidate, SourcingAdapter, SourcingQuery } from "./sourcing.ts";
import type { ApplyChange, ApplyResult, AtsAdapter } from "./types.ts";

function parseSnapshot(value: Json, expectedAts: AtsId): AtsSnapshot {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value.jobs) ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.applications)
  ) {
    throw new McpError("mcp_bad_response", "ats_snapshot must return { ats, jobs, candidates, applications }");
  }
  const ats = jsonString(value.ats);
  if (ats === undefined || parseAtsId(ats) !== expectedAts) {
    throw new McpError("mcp_bad_response", `ats_snapshot ats must be ${expectedAts}, got ${String(value.ats)}`);
  }
  const jobs: Job[] = [];
  for (const job of value.jobs) {
    const parsed = parseJob(job);
    if (!parsed) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed job");
    }
    jobs.push(parsed);
  }
  const candidates: Candidate[] = [];
  for (const candidate of value.candidates) {
    const parsed = parseCandidate(candidate);
    if (!parsed) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed candidate");
    }
    candidates.push(parsed);
  }
  const applications: Application[] = [];
  for (const application of value.applications) {
    const parsed = parseApplication(application);
    if (!parsed) {
      throw new McpError("mcp_bad_response", "ats_snapshot returned a malformed application");
    }
    applications.push(parsed);
  }
  return { ats: expectedAts, jobs, candidates, applications };
}

function parseApplyResult(value: Json): ApplyResult {
  if (!isJsonObject(value)) {
    throw new McpError("mcp_bad_response", "ats_apply must return { ok: true, remoteResult } or { ok: false, reason }");
  }
  if (value.ok === true) {
    return { ok: true, remoteResult: parseRemoteResult(value.remoteResult) };
  }
  if (value.ok === false && isJsonString(value.reason)) {
    return { ok: false, reason: value.reason };
  }
  throw new McpError("mcp_bad_response", "ats_apply must return { ok: true, remoteResult } or { ok: false, reason }");
}

function parseSourcedCandidates(value: Json): SourcedCandidate[] {
  if (!isJsonObject(value) || !Array.isArray(value.candidates)) {
    throw new McpError("mcp_bad_response", "source_search must return { candidates }");
  }
  return value.candidates.map((candidate) => {
    if (!isJsonObject(candidate)) {
      throw new McpError("mcp_bad_response", "source_search returned a malformed candidate");
    }
    const id = jsonString(candidate.id);
    const name = jsonString(candidate.name);
    const headline = jsonString(candidate.headline);
    const source = jsonString(candidate.source);
    if (!id || !name || !headline || !source) {
      throw new McpError("mcp_bad_response", "source_search returned a malformed candidate");
    }
    const sourced: SourcedCandidate = { id, name, headline, source };
    const score = jsonNumber(candidate.score);
    if (score !== undefined) sourced.score = score;
    return sourced;
  });
}

/** ATS backed by an MCP server implementing `ats_snapshot` / `ats_apply` (moks MCP ATS contract). */
export function createMcpAtsAdapter(config: McpServerConfig, options: { id: AtsId }): AtsAdapter {
  const client: SyncMcpClient = openSyncMcpClient(config);
  return {
    id: options.id,
    pull(): AtsSnapshot {
      return parseSnapshot(client.callTool(MCP_TOOL_ATS_SNAPSHOT, {}), options.id);
    },
    apply(change: ApplyChange): ApplyResult {
      const args: AtsApplyArgs = {
        entityType: change.entityType,
        entityRef: change.entityRef,
        mutation: change.mutation,
        precondition: parseJsonText(JSON.stringify(change.precondition)),
        payload: parseJsonText(JSON.stringify(change.payload)),
      };
      if (change.idempotencyKey !== undefined && change.idempotencyKey.length > 0) {
        args.idempotencyKey = change.idempotencyKey;
      }
      return parseApplyResult(client.callTool(MCP_TOOL_ATS_APPLY, args));
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
      const args: SourceSearchArgs = { role: query.role };
      if (query.limit !== undefined) args.limit = query.limit;
      return parseSourcedCandidates(client.callTool(MCP_TOOL_SOURCE_SEARCH, args));
    },
    close() {
      client.close();
    },
  };
}
