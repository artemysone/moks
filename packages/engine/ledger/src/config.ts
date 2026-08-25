import { existsSync, readFileSync } from "node:fs";
import type { AtsId } from "./domain.ts";
import { LedgerError } from "./errors.ts";
import { isJsonObject, isJsonString, jsonNumber, jsonString, parseJsonText, type Json } from "./json.ts";
import { workspacePaths } from "./paths.ts";

export type SourcingId = "juicebox" | "mcp";

export function resolveAtsId(env: NodeJS.ProcessEnv = process.env): AtsId {
  const raw = env.MOKS_ATS?.trim();
  if (!raw || raw === "mock") {
    return "mock";
  }
  if (raw === "greenhouse") {
    return "greenhouse";
  }
  if (raw === "ashby") {
    // MCP-backed; fails closed at adapter open unless `.moks/config.json` has `mcp.ats`.
    return "ashby";
  }
  throw new LedgerError(`unknown_ats: ${raw}`);
}

/** Default off. `MOKS_SOURCING=juicebox` enables the fixture adapter; `mcp` an MCP-backed one. */
export function resolveSourcingId(env: NodeJS.ProcessEnv = process.env): SourcingId | null {
  const raw = env.MOKS_SOURCING?.trim();
  if (!raw || raw === "off") {
    return null;
  }
  if (raw === "juicebox") {
    return "juicebox";
  }
  if (raw === "mcp") {
    return "mcp";
  }
  throw new LedgerError(`unknown_sourcing: ${raw}`);
}

/**
 * One MCP server connection: either `command` (stdio: spawn argv) or `url`
 * (streamable HTTP), never both. Lives under `mcp.ats` / `mcp.sourcing` in
 * `.moks/config.json`:
 *
 *   { "mcp": { "ats": { "command": ["bun", "fixtures/mock-mcp-ats.ts"] },
 *              "sourcing": { "url": "https://…/mcp" } } }
 */
export type McpServerConfig = {
  command?: string[];
  url?: string;
  /** Per-request timeout (also bounds connect). Default 10s. */
  timeoutMs?: number;
  /** Working directory for stdio commands; set to the workspace cwd on read. */
  cwd?: string;
};

export type McpConfig = {
  ats?: McpServerConfig;
  sourcing?: McpServerConfig;
};

function parseMcpServer(role: string, value: Json, cwd: string): McpServerConfig {
  if (!isJsonObject(value)) {
    throw new LedgerError(`mcp_config_invalid: mcp.${role} must be an object`);
  }
  const server: McpServerConfig = { cwd };

  if (value.command !== undefined) {
    if (!Array.isArray(value.command) || value.command.length === 0) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.command must be a non-empty string array`);
    }
    const command: string[] = [];
    for (const item of value.command) {
      if (!isJsonString(item) || item.length === 0) {
        throw new LedgerError(`mcp_config_invalid: mcp.${role}.command must be a non-empty string array`);
      }
      command.push(item);
    }
    server.command = command;
  }
  if (value.url !== undefined) {
    const url = jsonString(value.url);
    if (url === undefined || url.length === 0) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.url must be a non-empty string`);
    }
    server.url = url;
  }
  if ((server.command === undefined) === (server.url === undefined)) {
    throw new LedgerError(`mcp_config_invalid: mcp.${role} needs exactly one of command or url`);
  }
  if (value.timeoutMs !== undefined) {
    const timeoutMs = jsonNumber(value.timeoutMs);
    if (timeoutMs === undefined || timeoutMs <= 0) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.timeoutMs must be a positive number`);
    }
    server.timeoutMs = timeoutMs;
  }
  return server;
}

/**
 * MCP connection config from `.moks/config.json`. Missing file/key → {}
 * (callers fail closed). A file that exists but does not parse fails loudly:
 * silently reading it as {} would surface later as a misleading
 * `ats_unavailable` / `sourcing_unavailable`.
 */
export function readMcpConfig(cwd: string): McpConfig {
  const path = workspacePaths(cwd).configFile;
  if (!existsSync(path)) {
    return {};
  }
  let parsed: Json;
  try {
    parsed = parseJsonText(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new LedgerError(
      `mcp_config_invalid: ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!isJsonObject(parsed)) {
    return {};
  }
  if (parsed.mcp === undefined) {
    return {};
  }
  if (!isJsonObject(parsed.mcp)) {
    throw new LedgerError("mcp_config_invalid: mcp must be an object");
  }
  const config: McpConfig = {};
  if (parsed.mcp.ats !== undefined) {
    config.ats = parseMcpServer("ats", parsed.mcp.ats, cwd);
  }
  if (parsed.mcp.sourcing !== undefined) {
    config.sourcing = parseMcpServer("sourcing", parsed.mcp.sourcing, cwd);
  }
  return config;
}

export const SOURCE_SEARCH_DEFAULT_LIMIT = 10;
export const SOURCE_SEARCH_MAX_LIMIT = 25;

export function boundSourceLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return SOURCE_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(SOURCE_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}
