import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "../config.ts";
import { McpError } from "./errors.ts";
import type { McpToolInfo } from "./types.ts";

export const MCP_DEFAULT_TIMEOUT_MS = 10_000;

export type McpConnection = {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  /** Child process id for stdio transports (null for HTTP). */
  pid: number | null;
};

/** JSON-RPC error code the SDK uses for request timeouts. */
const REQUEST_TIMEOUT_CODE = -32001;

function jsonRpcCode(error: unknown): number | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") {
    return error.code;
  }
  return null;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertMcpServerConfig(config: McpServerConfig): void {
  const hasCommand = Array.isArray(config.command) && config.command.length > 0;
  const hasUrl = typeof config.url === "string" && config.url.length > 0;
  if (hasCommand === hasUrl) {
    throw new McpError("mcp_config_invalid", "expected exactly one of command or url");
  }
}

function createTransport(config: McpServerConfig): Transport {
  if (config.command && config.command.length > 0) {
    const [command, ...args] = config.command;
    return new StdioClientTransport({
      command: command as string,
      args,
      stderr: "ignore",
      ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    });
  }
  let url: URL;
  try {
    url = new URL(config.url as string);
  } catch {
    throw new McpError("mcp_config_invalid", `invalid url: ${config.url}`);
  }
  // Cast: the SDK's optional `sessionId` clashes with exactOptionalPropertyTypes.
  return new StreamableHTTPClientTransport(url) as unknown as Transport;
}

/** Extract the JSON payload of a tool result: structuredContent, else first text item parsed as JSON. */
function extractResult(name: string, result: Record<string, unknown>): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
  const text = content.find((item) => item.type === "text");
  if (!text || typeof text.text !== "string") {
    throw new McpError("mcp_bad_response", `${name} returned no JSON content`);
  }
  try {
    return JSON.parse(text.text) as unknown;
  } catch {
    throw new McpError("mcp_bad_response", `${name} returned non-JSON content`);
  }
}

function toolErrorText(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
  const text = content.find((item) => item.type === "text");
  return text && typeof text.text === "string" ? text.text : "tool reported an error";
}

/** Thin async wrapper over the official SDK: stdio (spawn a command) or streamable HTTP (url). */
export async function connectMcp(config: McpServerConfig): Promise<McpConnection> {
  assertMcpServerConfig(config);
  const timeoutMs = config.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
  const client = new Client({ name: "moks", version: "0.1.0" });
  const transport = createTransport(config);
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error) {
    await transport.close().catch(() => {});
    if (error instanceof McpError) {
      throw error;
    }
    if (jsonRpcCode(error) === REQUEST_TIMEOUT_CODE) {
      throw new McpError("mcp_timeout", `connect timed out after ${timeoutMs}ms`);
    }
    throw new McpError("mcp_connect_failed", detail(error));
  }

  return {
    async listTools() {
      let listed: Awaited<ReturnType<Client["listTools"]>>;
      try {
        listed = await client.listTools(undefined, { timeout: timeoutMs });
      } catch (error) {
        if (jsonRpcCode(error) === REQUEST_TIMEOUT_CODE) {
          throw new McpError("mcp_timeout", `listTools timed out after ${timeoutMs}ms`);
        }
        throw new McpError("mcp_tool_failed", detail(error));
      }
      return listed.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
      }));
    },
    async callTool(name, args = {}) {
      let result: Record<string, unknown>;
      try {
        result = (await client.callTool({ name, arguments: args }, undefined, {
          timeout: timeoutMs,
        })) as Record<string, unknown>;
      } catch (error) {
        if (jsonRpcCode(error) === REQUEST_TIMEOUT_CODE) {
          throw new McpError("mcp_timeout", `${name} timed out after ${timeoutMs}ms`);
        }
        throw new McpError("mcp_tool_failed", `${name}: ${detail(error)}`);
      }
      if (result.isError) {
        throw new McpError("mcp_tool_failed", `${name}: ${toolErrorText(result)}`);
      }
      return extractResult(name, result);
    },
    async close() {
      await client.close();
    },
    pid: stdioPid(transport),
  };
}

function stdioPid(transport: Transport): number | null {
  const pid = (transport as { pid?: unknown }).pid;
  return typeof pid === "number" ? pid : null;
}
