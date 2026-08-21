import type { McpErrorCode } from "./errors.ts";

/**
 * moks MCP ATS contract. A server backs an ATS by exposing:
 * - `ats_snapshot` (no args) → the same snapshot JSON shape `AtsAdapter.pull` produces.
 * - `ats_apply` (an `ApplyChange`, plus an optional client-generated `idempotencyKey`
 *   string) → the same `ApplyResult` shape `AtsAdapter.apply` produces, with CAS
 *   semantics (`precondition_failed` on stale preconditions). When an
 *   `idempotencyKey` is present, the server must record the result of a successful
 *   apply under that key and return the recorded result for a replayed key without
 *   re-executing the mutation, so retried/replayed pushes (timeouts, rebases of
 *   partially applied changesets) never duplicate side effects like notes or
 *   outreach. Failed applies are not recorded; a replay re-evaluates them.
 * A sourcing server exposes:
 * - `source_search` ({ role, limit? }) → { candidates: SourcedCandidate[] }.
 * Results are returned as JSON text content (first `text` item), or `structuredContent`.
 */
export const MCP_TOOL_ATS_SNAPSHOT = "ats_snapshot";
export const MCP_TOOL_ATS_APPLY = "ats_apply";
export const MCP_TOOL_SOURCE_SEARCH = "source_search";

export type McpToolInfo = {
  name: string;
  description?: string;
};

/** Bridge protocol between the sync client and its worker thread. */
export type BridgeRequest = {
  op: "listTools" | "callTool" | "close";
  name?: string;
  args?: Record<string, unknown>;
  /** Int32 flag the worker stores/notifies when the response message is queued. */
  signal: SharedArrayBuffer;
};

export type BridgeResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: McpErrorCode; detail: string } };
