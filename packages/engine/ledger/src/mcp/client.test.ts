import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "../config.ts";
import { isJsonObject, type Json } from "../json.ts";
import { connectMcp, type McpConnection } from "./client.ts";
import { McpError } from "./errors.ts";
import { openSyncMcpClient } from "./sync-client.ts";
import { MCP_TOOL_ATS_APPLY, MCP_TOOL_ATS_SNAPSHOT, MCP_TOOL_SOURCE_SEARCH } from "./types.ts";

const FIXTURE_SERVER = fileURLToPath(new URL("../../fixtures/mock-mcp-ats.ts", import.meta.url));

function fixtureConfig(timeoutMs = 8_000): McpServerConfig {
  return { command: ["bun", FIXTURE_SERVER], timeoutMs };
}

async function expectMcpErrorAsync(promise: Promise<Json | McpConnection | void>): Promise<McpError> {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof McpError) return cause;
    throw cause;
  }
  throw new Error("expected McpError");
}

function expectMcpError(fn: () => void): McpError {
  try {
    fn();
  } catch (cause) {
    if (cause instanceof McpError) return cause;
    throw cause;
  }
  throw new Error("expected McpError");
}

describe("connectMcp (async client)", () => {
  test("lists tools and calls them over stdio", async () => {
    const connection = await connectMcp(fixtureConfig());
    try {
      const tools = (await connection.listTools()).map((tool) => tool.name);
      expect(tools).toContain(MCP_TOOL_ATS_SNAPSHOT);
      expect(tools).toContain(MCP_TOOL_ATS_APPLY);
      expect(tools).toContain(MCP_TOOL_SOURCE_SEARCH);

      const snapshot = await connection.callTool(MCP_TOOL_ATS_SNAPSHOT);
      if (!isJsonObject(snapshot) || !Array.isArray(snapshot.jobs)) throw new Error("expected snapshot");
      expect(snapshot.ats).toBe("ashby");
      expect(snapshot.jobs).toHaveLength(1);
    } finally {
      await connection.close();
    }
  });

  test("unknown tool fails with a structured error", async () => {
    const connection = await connectMcp(fixtureConfig());
    try {
      const error = await expectMcpErrorAsync(connection.callTool("no_such_tool"));
      expect(error.code).toBe("mcp_tool_failed");
    } finally {
      await connection.close();
    }
  });

  test("slow tool call times out with mcp_timeout", async () => {
    const connection = await connectMcp(fixtureConfig(500));
    try {
      const error = await expectMcpErrorAsync(connection.callTool("debug_sleep", { ms: 10_000 }));
      expect(error.code).toBe("mcp_timeout");
    } finally {
      await connection.close();
    }
  });

  test("missing binary fails closed with mcp_connect_failed", async () => {
    const error = await expectMcpErrorAsync(
      connectMcp({ command: ["/nonexistent/mox-mcp-binary"], timeoutMs: 2_000 }),
    );
    expect(error.code).toBe("mcp_connect_failed");
  });

  test("server that exits immediately fails closed", async () => {
    const error = await expectMcpErrorAsync(connectMcp({ command: ["bun", "-e", "process.exit(1)"], timeoutMs: 3_000 }));
    expect(error.code).toBe("mcp_connect_failed");
  });

  test("unreachable http url fails closed", async () => {
    const error = await expectMcpErrorAsync(connectMcp({ url: "http://127.0.0.1:9/mcp", timeoutMs: 2_000 }));
    expect(error.code).toBe("mcp_connect_failed");
  });

  test("config must have exactly one of command or url", async () => {
    const neither = await expectMcpErrorAsync(connectMcp({}));
    expect(neither.code).toBe("mcp_config_invalid");
    const both = await expectMcpErrorAsync(
      connectMcp({ command: ["bun"], url: "http://127.0.0.1:9/mcp" }),
    );
    expect(both.code).toBe("mcp_config_invalid");
  });
});

describe("openSyncMcpClient (sync bridge)", () => {
  test("synchronous listTools / callTool round trip", () => {
    const client = openSyncMcpClient(fixtureConfig());
    try {
      const tools = client.listTools().map((tool) => tool.name);
      expect(tools).toContain(MCP_TOOL_ATS_SNAPSHOT);

      const snapshot = client.callTool(MCP_TOOL_ATS_SNAPSHOT);
      if (!isJsonObject(snapshot) || !Array.isArray(snapshot.applications)) throw new Error("expected snapshot");
      expect(snapshot.ats).toBe("ashby");
      expect(snapshot.applications).toHaveLength(3);

      const search = client.callTool(MCP_TOOL_SOURCE_SEARCH, { role: "backend", limit: 1 });
      if (!isJsonObject(search) || !Array.isArray(search.candidates) || !isJsonObject(search.candidates[0])) {
        throw new Error("expected search");
      }
      expect(search.candidates).toHaveLength(1);
      expect(search.candidates[0].id).toBe("mcp_ada");
    } finally {
      client.close();
    }
  });

  test("close is idempotent and later calls fail closed", () => {
    const client = openSyncMcpClient(fixtureConfig());
    client.close();
    client.close();
    const error = expectMcpError(() => client.callTool(MCP_TOOL_ATS_SNAPSHOT));
    expect(error.code).toBe("mcp_unavailable");
  });

  test("unreachable server surfaces a structured error without hanging", () => {
    const client = openSyncMcpClient({ command: ["bun", "-e", "process.exit(0)"], timeoutMs: 3_000 });
    try {
      const error = expectMcpError(() => client.callTool(MCP_TOOL_ATS_SNAPSHOT));
      expect(error.code).toBe("mcp_connect_failed");
    } finally {
      client.close();
    }
  });

  test("slow tool call times out without hanging", () => {
    const client = openSyncMcpClient(fixtureConfig(500));
    try {
      const error = expectMcpError(() => client.callTool("debug_sleep", { ms: 10_000 }));
      expect(error.code).toBe("mcp_timeout");
    } finally {
      client.close();
    }
  });

  test("close after a timed-out call does not orphan the spawned server process", async () => {
    const client = openSyncMcpClient(fixtureConfig(500));
    let pid: number | null = null;
    try {
      // The server is stuck in a long sleep when the call times out; a close
      // that gives up too early would terminate the worker and leave the
      // spawned server process running.
      const error = expectMcpError(() => client.callTool("debug_sleep", { ms: 30_000 }));
      expect(error.code).toBe("mcp_timeout");
      pid = client.serverPid();
      expect(pid).not.toBeNull();
      if (pid === null) throw new Error("expected pid");
      expect(processAlive(pid)).toBe(true);
    } finally {
      client.close();
    }
    if (pid === null) throw new Error("expected pid");
    await waitForExit(pid, 8_000);
    expect(processAlive(pid)).toBe(false);
  });
});

/** Alive and not a zombie (a terminated worker can leave the child unreaped). */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const state = Bun.spawnSync(["ps", "-p", String(pid), "-o", "state="]).stdout.toString().trim();
  return state.length > 0 && !state.startsWith("Z");
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && processAlive(pid)) {
    await Bun.sleep(100);
  }
}
