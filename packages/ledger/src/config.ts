import { existsSync, readFileSync } from "node:fs";
import type { AtsId } from "./domain.ts";
import { LedgerError } from "./errors.ts";
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

function parseMcpServer(role: string, value: unknown, cwd: string): McpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerError(`mcp_config_invalid: mcp.${role} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const server: McpServerConfig = { cwd };

  if (record.command !== undefined) {
    if (
      !Array.isArray(record.command) ||
      record.command.length === 0 ||
      !record.command.every((item) => typeof item === "string" && item.length > 0)
    ) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.command must be a non-empty string array`);
    }
    server.command = record.command as string[];
  }
  if (record.url !== undefined) {
    if (typeof record.url !== "string" || record.url.length === 0) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.url must be a non-empty string`);
    }
    server.url = record.url;
  }
  if ((server.command === undefined) === (server.url === undefined)) {
    throw new LedgerError(`mcp_config_invalid: mcp.${role} needs exactly one of command or url`);
  }
  if (record.timeoutMs !== undefined) {
    if (typeof record.timeoutMs !== "number" || !Number.isFinite(record.timeoutMs) || record.timeoutMs <= 0) {
      throw new LedgerError(`mcp_config_invalid: mcp.${role}.timeoutMs must be a positive number`);
    }
    server.timeoutMs = record.timeoutMs;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError(
      `mcp_config_invalid: ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const mcp = (parsed as Record<string, unknown>).mcp;
  if (mcp === undefined) {
    return {};
  }
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) {
    throw new LedgerError("mcp_config_invalid: mcp must be an object");
  }
  const record = mcp as Record<string, unknown>;
  const config: McpConfig = {};
  if (record.ats !== undefined) {
    config.ats = parseMcpServer("ats", record.ats, cwd);
  }
  if (record.sourcing !== undefined) {
    config.sourcing = parseMcpServer("sourcing", record.sourcing, cwd);
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
