import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "../config.ts";
import { isJsonObject, isJsonString, parseJsonText, type Json } from "../json.ts";
import { McpError } from "./errors.ts";
import type { McpCallArgs, McpToolInfo } from "./types.ts";

export const MCP_DEFAULT_TIMEOUT_MS = 10_000;

export type McpConnection = {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args?: McpCallArgs): Promise<Json>;
  close(): Promise<void>;
  /** Child process id for stdio transports (null for HTTP). */
  pid: number | null;
};

type McpContentItem = {
  type?: string;
  text?: string;
};

type McpToolResult = {
  structuredContent?: Json;
  content?: McpContentItem[];
  isError?: boolean;
};

type StdioTransportOptions = {
  command: string;
  args: string[];
  stderr: "ignore";
  cwd?: string;
};

/** JSON-RPC error code the SDK uses for request timeouts. */
const REQUEST_TIMEOUT_CODE = -32001;

function jsonRpcCode(cause: unknown): number | null {
  if (cause === null || cause === undefined || cause === true || cause === false) return null;
  if (Array.isArray(cause)) return null;
  const wrapped = Object(cause);
  if (!("code" in wrapped)) return null;
  const code = Number(wrapped.code);
  if (!Number.isFinite(code)) return null;
  return code;
}

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function assertMcpServerConfig(config: McpServerConfig): void {
  const hasCommand = Array.isArray(config.command) && config.command.length > 0;
  const hasUrl = config.url !== undefined && config.url.length > 0;
  if (hasCommand === hasUrl) {
    throw new McpError("mcp_config_invalid", "expected exactly one of command or url");
  }
}

function createTransport(config: McpServerConfig): Transport {
  if (config.command && config.command.length > 0) {
    const command = config.command[0];
    if (command === undefined) {
      throw new McpError("mcp_config_invalid", "expected exactly one of command or url");
    }
    const options: StdioTransportOptions = {
      command,
      args: config.command.slice(1),
      stderr: "ignore",
    };
    if (config.cwd !== undefined) options.cwd = config.cwd;
    return new StdioClientTransport(options);
  }
  if (config.url === undefined) {
    throw new McpError("mcp_config_invalid", "expected exactly one of command or url");
  }
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new McpError("mcp_config_invalid", `invalid url: ${config.url}`);
  }
  // SAFETY: SDK optional sessionId clashes with exactOptionalPropertyTypes.
  return new StreamableHTTPClientTransport(url) as Transport;
}

function parseToolContent(result: McpToolResult): McpContentItem[] {
  if (result.content === undefined) return [];
  return result.content;
}

/** Extract the JSON payload of a tool result: structuredContent, else first text item parsed as JSON. */
function extractResult(name: string, result: McpToolResult): Json {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = parseToolContent(result).find((item) => item.type === "text");
  if (!text || text.text === undefined) {
    throw new McpError("mcp_bad_response", `${name} returned no JSON content`);
  }
  try {
    return parseJsonText(text.text);
  } catch {
    throw new McpError("mcp_bad_response", `${name} returned non-JSON content`);
  }
}

function toolErrorText(result: McpToolResult): string {
  const text = parseToolContent(result).find((item) => item.type === "text");
  return text && text.text !== undefined ? text.text : "tool reported an error";
}

function parseToolResult(value: Json): McpToolResult {
  if (!isJsonObject(value)) {
    return {};
  }
  const result: McpToolResult = {};
  if (value.structuredContent !== undefined) result.structuredContent = value.structuredContent;
  if (Array.isArray(value.content)) {
    const content: McpContentItem[] = [];
    for (const item of value.content) {
      if (!isJsonObject(item)) continue;
      const entry: McpContentItem = {};
      const type = jsonStringField(item.type);
      if (type !== undefined) entry.type = type;
      const text = jsonStringField(item.text);
      if (text !== undefined) entry.text = text;
      content.push(entry);
    }
    result.content = content;
  }
  if (value.isError === true) result.isError = true;
  return result;
}

function jsonStringField(value: Json | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isJsonString(value) ? value : undefined;
}

/** Thin async wrapper over the official SDK: stdio (spawn a command) or streamable HTTP (url). */
export async function connectMcp(config: McpServerConfig): Promise<McpConnection> {
  assertMcpServerConfig(config);
  const timeoutMs = config.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
  const client = new Client({ name: "moks", version: "0.1.0" });
  const transport = createTransport(config);
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (cause) {
    await transport.close().catch(() => {});
    if (cause instanceof McpError) {
      throw cause;
    }
    if (jsonRpcCode(cause) === REQUEST_TIMEOUT_CODE) {
      throw new McpError("mcp_timeout", `connect timed out after ${timeoutMs}ms`);
    }
    throw new McpError("mcp_connect_failed", detail(cause));
  }

  return {
    async listTools() {
      let listed: Awaited<ReturnType<Client["listTools"]>>;
      try {
        listed = await client.listTools(undefined, { timeout: timeoutMs });
      } catch (cause) {
        if (jsonRpcCode(cause) === REQUEST_TIMEOUT_CODE) {
          throw new McpError("mcp_timeout", `listTools timed out after ${timeoutMs}ms`);
        }
        throw new McpError("mcp_tool_failed", detail(cause));
      }
      return listed.tools.map((tool) => {
        const info: McpToolInfo = { name: tool.name };
        if (tool.description !== undefined) info.description = tool.description;
        return info;
      });
    },
    async callTool(name, args = {}) {
      let result: McpToolResult;
      try {
        const raw = await client.callTool({ name, arguments: args }, undefined, {
          timeout: timeoutMs,
        });
        result = parseToolResult(parseJsonText(JSON.stringify(raw)));
      } catch (cause) {
        if (jsonRpcCode(cause) === REQUEST_TIMEOUT_CODE) {
          throw new McpError("mcp_timeout", `${name} timed out after ${timeoutMs}ms`);
        }
        throw new McpError("mcp_tool_failed", `${name}: ${detail(cause)}`);
      }
      if (result.isError) {
        throw new McpError("mcp_tool_failed", `${name}: ${toolErrorText(result)}`);
      }
      return extractResult(name, result);
    },
    async close() {
      await client.close();
    },
    get pid() {
      return stdioPid(transport);
    },
  };
}

function stdioPid(transport: Transport): number | null {
  if (!("pid" in transport)) return null;
  const raw = transport.pid;
  if (raw === null || raw === undefined) return null;
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}
