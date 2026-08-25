import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ApplyResult } from "../adapters/types.ts";
import type { SourcedCandidate } from "../adapters/sourcing.ts";
import {
  canExitToTerminal,
  isAdvanceStagePayload,
  isAddNotePayload,
  isAddTagPayload,
  isApplication,
  isEntityType,
  isExtendOfferPayload,
  isLegalAdvanceOnPath,
  isMutation,
  isSendOutreachPayload,
  parseAtsFixture,
  parseCasField,
  parseMutationPayload,
  type Application,
  type ApplicationStage,
  type AtsId,
  type AtsSnapshot,
  type Candidate,
  type CasField,
  type EntityType,
  type Job,
  type Mutation,
  type MutationPayload,
} from "../domain.ts";
import { isJsonObject, jsonNumber, jsonString, parseJsonText, type Json, type JsonObject } from "../json.ts";
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

type ParsedApply = {
  entityType: EntityType;
  entityRef: string;
  mutation: Mutation;
  precondition: CasField;
  payload: MutationPayload;
  idempotencyKey: string | null;
};

type SourcedSearch = { candidates: SourcedCandidate[] };

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

function parseFixtureDataset(input: Json): FixtureDataset {
  const fixture = parseAtsFixture(input);
  if (!isJsonObject(input)) {
    return fixture;
  }
  const atsRaw = jsonString(input.ats);
  const ats: AtsId | undefined = atsRaw === "mock" || atsRaw === "ashby" || atsRaw === "greenhouse" ? atsRaw : undefined;
  const sourcing: FixtureSourcedCandidate[] = [];
  if (Array.isArray(input.sourcing)) {
    for (const item of input.sourcing) {
      if (!isJsonObject(item)) continue;
      const id = jsonString(item.id);
      const name = jsonString(item.name);
      const headline = jsonString(item.headline);
      if (!id || !name || !headline) continue;
      const candidate: FixtureSourcedCandidate = { id, name, headline };
      const title = jsonString(item.title);
      if (title !== undefined) candidate.title = title;
      const source = jsonString(item.source);
      if (source !== undefined) candidate.source = source;
      const score = jsonNumber(item.score);
      if (score !== undefined) candidate.score = score;
      sourcing.push(candidate);
    }
  }
  return ats === undefined && sourcing.length === 0 ? fixture : { ...fixture, ats, sourcing };
}

function parseApplyArgs(args: JsonObject): ParsedApply | { error: ApplyResult } {
  const entityTypeRaw = jsonString(args.entityType) ?? "";
  const entityRef = jsonString(args.entityRef) ?? "";
  const mutationRaw = jsonString(args.mutation) ?? "";
  if (!isEntityType(entityTypeRaw) || !isMutation(mutationRaw)) {
    return { error: { ok: false, reason: "unsupported" } };
  }
  let payload: MutationPayload;
  try {
    payload = parseMutationPayload(mutationRaw, args.payload ?? {});
  } catch {
    return { error: { ok: false, reason: "unsupported" } };
  }
  let precondition: CasField;
  try {
    precondition = parseCasField(args.precondition ?? {});
  } catch {
    return { error: { ok: false, reason: "unsupported" } };
  }
  const key = jsonString(args.idempotencyKey);
  return {
    entityType: entityTypeRaw,
    entityRef,
    mutation: mutationRaw,
    precondition,
    payload,
    idempotencyKey: key !== undefined && key.length > 0 ? key : null,
  };
}

/** In-memory ATS with the same apply semantics as the mock/greenhouse adapters. */
export function createFixtureState(dataset: FixtureDataset, options?: { stages?: readonly ApplicationStage[] }) {
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
  function apply(args: JsonObject): ApplyResult {
    const parsed = parseApplyArgs(args);
    if ("error" in parsed) {
      return parsed.error;
    }
    if (parsed.idempotencyKey) {
      const recorded = appliedByKey.get(parsed.idempotencyKey);
      if (recorded) {
        return recorded;
      }
    }
    const result = applyOnce(parsed);
    if (parsed.idempotencyKey && result.ok) {
      appliedByKey.set(parsed.idempotencyKey, result);
    }
    return result;
  }

  function applyOnce(parsed: ParsedApply): ApplyResult {
    const current =
      parsed.entityType === "application"
        ? applications.find((application) => application.id === parsed.entityRef)
        : parsed.entityType === "candidate"
          ? candidates.find((candidate) => candidate.id === parsed.entityRef)
          : jobs.find((job) => job.id === parsed.entityRef);
    if (!current) {
      return { ok: false, reason: "unknown_entity" };
    }
    if (isEmptyPrecondition(parsed.precondition)) {
      return { ok: false, reason: "empty_precondition" };
    }
    const projection = casProjection(parsed.entityType, current);
    if (!projection || !matchesPrecondition(projection, parsed.precondition)) {
      return { ok: false, reason: "precondition_failed" };
    }

    switch (parsed.mutation) {
      case "AdvanceStage": {
        if (parsed.entityType !== "application" || !isApplication(current) || !isAdvanceStagePayload(parsed.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!isLegalAdvanceOnPath(current.stage, parsed.payload.to, options?.stages)) {
          return { ok: false, reason: "illegal_transition" };
        }
        current.stage = parsed.payload.to;
        return { ok: true, remoteResult: { ...current } };
      }
      case "Reject":
      case "Withdraw": {
        if (parsed.entityType !== "application" || !isApplication(current)) {
          return { ok: false, reason: "unsupported" };
        }
        if (!canExitToTerminal(current.stage)) {
          return { ok: false, reason: "illegal_transition" };
        }
        current.stage = parsed.mutation === "Reject" ? "Rejected" : "Withdrawn";
        return { ok: true, remoteResult: { ...current } };
      }
      case "AddNote": {
        if (!isAddNotePayload(parsed.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        const id = crypto.randomUUID();
        notes.push({ id, body: parsed.payload.body });
        return { ok: true, remoteResult: { noteId: id } };
      }
      case "AddTag": {
        if (!isAddTagPayload(parsed.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        tags.add(`${parsed.entityType}:${parsed.entityRef}:${parsed.payload.tag}`);
        return { ok: true, remoteResult: { tag: parsed.payload.tag } };
      }
      case "SendOutreach": {
        if (!isSendOutreachPayload(parsed.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        const channel =
          parsed.payload.channel !== undefined && parsed.payload.channel.length > 0 ? parsed.payload.channel : "email";
        return { ok: true, remoteResult: { outreachId: crypto.randomUUID(), channel } };
      }
      case "ExtendOffer": {
        if (parsed.entityType !== "application" || !isExtendOfferPayload(parsed.payload)) {
          return { ok: false, reason: "unsupported" };
        }
        return { ok: true, remoteResult: { offerId: crypto.randomUUID() } };
      }
      default:
        return { ok: false, reason: "unsupported" };
    }
  }

  function search(args: JsonObject): SourcedSearch {
    const role = jsonString(args.role) ?? "";
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
    const limitRaw = jsonNumber(args.limit);
    const limit = limitRaw !== undefined ? limitRaw : matched.length;
    return {
      candidates: matched.slice(0, Math.max(0, limit)).map((candidate) => {
        const sourced: SourcedCandidate = {
          id: candidate.id,
          name: candidate.name,
          headline: candidate.headline,
          source: candidate.source ?? "juicebox",
        };
        if (candidate.score !== undefined) sourced.score = candidate.score;
        return sourced;
      }),
    };
  }

  return { snapshot, apply, search };
}

function requestArgs(value: Json | undefined): JsonObject {
  if (value !== undefined && isJsonObject(value)) return value;
  return {};
}

/** Stdio MCP server for tests: `ats_snapshot` / `ats_apply` / `source_search` over a fixture dataset. */
export async function runMockMcpAtsServer(options: { datasetPath: string }): Promise<void> {
  const dataset = parseFixtureDataset(parseJsonText(readFileSync(options.datasetPath, "utf8")));
  const state = createFixtureState(dataset);

  const server = new Server({ name: "moks-mock-mcp-ats", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = requestArgs(parseJsonText(JSON.stringify(request.params.arguments ?? {})));
    switch (request.params.name) {
      case MCP_TOOL_ATS_SNAPSHOT:
        return { content: [{ type: "text", text: JSON.stringify(state.snapshot()) }] };
      case MCP_TOOL_ATS_APPLY:
        return { content: [{ type: "text", text: JSON.stringify(state.apply(args)) }] };
      case MCP_TOOL_SOURCE_SEARCH:
        return { content: [{ type: "text", text: JSON.stringify(state.search(args)) }] };
      case "debug_sleep": {
        const ms = jsonNumber(args.ms) ?? 0;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { content: [{ type: "text", text: JSON.stringify({ slept: ms }) }] };
      }
      default:
        throw new Error(`unknown_tool: ${request.params.name}`);
    }
  });

  await server.connect(new StdioServerTransport());
}
