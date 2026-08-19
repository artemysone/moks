import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ApplyResult } from "../adapters/types.ts";
import type { SourcedCandidate } from "../adapters/sourcing.ts";
import {
  canExitToTerminal,
  isEntityType,
  isLegalAdvance,
  isMutation,
  isStage,
  type Application,
  type AtsId,
  type AtsSnapshot,
  type Candidate,
  type Job,
} from "../domain.ts";
import { casProjection, isEmptyPrecondition, matchesPrecondition } from "../precondition.ts";
import { MCP_TOOL_ATS_APPLY, MCP_TOOL_ATS_SNAPSHOT, MCP_TOOL_SOURCE_SEARCH } from "./types.ts";

type FixtureSourcedCandidate = {
  id: string;
  name: string;
  headline: string;
  title?: string;
  source?: string;
  score?: number;
};

type FixtureDataset = {
  ats?: AtsId;
  jobs: Job[];
  candidates: Candidate[];
  applications: Application[];
  sourcing?: FixtureSourcedCandidate[];
};

const TOOLS = [
  {
    name: MCP_TOOL_ATS_SNAPSHOT,
    description: "Full ATS snapshot: { ats, jobs, candidates, applications }.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: MCP_TOOL_ATS_APPLY,
    description: "CAS apply of one mutation. Returns { ok: true, remoteResult } or { ok: false, reason }.",
    inputSchema: {
      type: "object" as const,
      required: ["entityType", "entityRef", "mutation", "precondition", "payload"],
      properties: {
        entityType: { type: "string" },
        entityRef: { type: "string" },
        mutation: { type: "string" },
        precondition: {},
        payload: {},
        idempotencyKey: {
          type: "string",
          description: "Replays of a key whose apply succeeded return the recorded result without re-executing.",
        },
      },
    },
  },
  {
    name: MCP_TOOL_SOURCE_SEARCH,
    description: "Keyword search over sourced candidates. Returns { candidates: [...] }.",
    inputSchema: {
      type: "object" as const,
      required: ["role"],
      properties: { role: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "debug_sleep",
    description: "Test helper: resolves after { ms } milliseconds.",
    inputSchema: { type: "object" as const, required: ["ms"], properties: { ms: { type: "number" } } },
  },
];

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

/** In-memory ATS with the same apply semantics as the mock/greenhouse adapters. */
export function createFixtureState(dataset: FixtureDataset) {
  const ats: AtsId = dataset.ats ?? "ashby";
  const jobs = dataset.jobs.map((job) => ({ ...job }));
  const candidates = dataset.candidates.map((candidate) => ({ ...candidate }));
  const applications = dataset.applications.map((application) => ({ ...application }));
  const sourcing = (dataset.sourcing ?? []).map((candidate) => ({ ...candidate }));
  const notes: Array<{ id: string; body: string }> = [];
  const tags = new Set<string>();
  const appliedByKey = new Map<string, ApplyResult>();

  function snapshot(): AtsSnapshot {
    return { ats, jobs, candidates, applications };
  }

  /** Idempotency: a replayed key whose apply succeeded returns the recorded result, never re-executes. */
  function apply(args: Record<string, unknown>): ApplyResult {
    const idempotencyKey =
      typeof args.idempotencyKey === "string" && args.idempotencyKey.length > 0 ? args.idempotencyKey : null;
    if (idempotencyKey) {
      const recorded = appliedByKey.get(idempotencyKey);
      if (recorded) {
        return recorded;
      }
    }
    const result = applyOnce(args);
    // Failures are not recorded: a replayed key re-evaluates against current state.
    if (idempotencyKey && result.ok) {
      appliedByKey.set(idempotencyKey, result);
    }
    return result;
  }

  function applyOnce(args: Record<string, unknown>): ApplyResult {
    const entityType = typeof args.entityType === "string" ? args.entityType : "";
    const entityRef = typeof args.entityRef === "string" ? args.entityRef : "";
    const mutation = typeof args.mutation === "string" ? args.mutation : "";
    if (!isEntityType(entityType) || !isMutation(mutation)) {
      return { ok: false, reason: "unsupported" };
    }

    const current =
      entityType === "application"
        ? applications.find((application) => application.id === entityRef)
        : entityType === "candidate"
          ? candidates.find((candidate) => candidate.id === entityRef)
          : jobs.find((job) => job.id === entityRef);
    if (!current) {
      return { ok: false, reason: "unknown_entity" };
    }
    if (isEmptyPrecondition(args.precondition)) {
      return { ok: false, reason: "empty_precondition" };
    }
    const projection = casProjection(entityType, current);
    if (!projection || !matchesPrecondition(projection, args.precondition)) {
      return { ok: false, reason: "precondition_failed" };
    }

    const payload = payloadRecord(args.payload);

    switch (mutation) {
      case "AdvanceStage": {
        if (entityType !== "application") {
          return { ok: false, reason: "unsupported" };
        }
        const application = current as Application;
        if (typeof payload.to !== "string" || !isStage(payload.to)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!isLegalAdvance(application.stage, payload.to)) {
          return { ok: false, reason: "illegal_transition" };
        }
        application.stage = payload.to;
        return { ok: true, remoteResult: { ...application } };
      }
      case "Reject":
      case "Withdraw": {
        if (entityType !== "application") {
          return { ok: false, reason: "unsupported" };
        }
        const application = current as Application;
        if (!canExitToTerminal(application.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        application.stage = mutation === "Reject" ? "Rejected" : "Withdrawn";
        return { ok: true, remoteResult: { ...application } };
      }
      case "AddNote": {
        if (typeof payload.body !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        notes.push({ id, body: payload.body });
        return { ok: true, remoteResult: { noteId: id } };
      }
      case "AddTag": {
        if (typeof payload.tag !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        tags.add(`${entityType}:${entityRef}:${payload.tag}`);
        return { ok: true, remoteResult: { tag: payload.tag } };
      }
      case "SendOutreach": {
        if (typeof payload.body !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        const channel = typeof payload.channel === "string" && payload.channel.length > 0 ? payload.channel : "email";
        return { ok: true, remoteResult: { outreachId: crypto.randomUUID(), channel } };
      }
      case "ExtendOffer": {
        if (entityType !== "application" || typeof payload.terms !== "string") {
          return { ok: false, reason: "unsupported" };
        }
        return { ok: true, remoteResult: { offerId: crypto.randomUUID() } };
      }
      default:
        return { ok: false, reason: "unsupported" };
    }
  }

  function search(args: Record<string, unknown>): { candidates: SourcedCandidate[] } {
    const role = typeof args.role === "string" ? args.role : "";
    const keywords = role
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2);
    const matched = keywords.length
      ? sourcing.filter((candidate) =>
          keywords.some((keyword) => `${candidate.headline} ${candidate.title ?? ""}`.toLowerCase().includes(keyword)),
        )
      : [];
    matched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : matched.length;
    return {
      candidates: matched.slice(0, Math.max(0, limit)).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        headline: candidate.headline,
        source: candidate.source ?? "juicebox",
        ...(candidate.score !== undefined ? { score: candidate.score } : {}),
      })),
    };
  }

  return { snapshot, apply, search };
}

/** Stdio MCP server for tests: `ats_snapshot` / `ats_apply` / `source_search` over a fixture dataset. */
export async function runMockMcpAtsServer(options: { datasetPath: string }): Promise<void> {
  const dataset = JSON.parse(readFileSync(options.datasetPath, "utf8")) as FixtureDataset;
  const state = createFixtureState(dataset);

  const server = new Server({ name: "mox-mock-mcp-ats", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    switch (request.params.name) {
      case MCP_TOOL_ATS_SNAPSHOT:
        return { content: [{ type: "text", text: JSON.stringify(state.snapshot()) }] };
      case MCP_TOOL_ATS_APPLY:
        return { content: [{ type: "text", text: JSON.stringify(state.apply(args)) }] };
      case MCP_TOOL_SOURCE_SEARCH:
        return { content: [{ type: "text", text: JSON.stringify(state.search(args)) }] };
      case "debug_sleep": {
        const ms = typeof args.ms === "number" ? args.ms : 0;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { content: [{ type: "text", text: JSON.stringify({ slept: ms }) }] };
      }
      default:
        throw new Error(`unknown_tool: ${request.params.name}`);
    }
  });

  await server.connect(new StdioServerTransport());
}
