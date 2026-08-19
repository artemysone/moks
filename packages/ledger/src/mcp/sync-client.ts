import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "../config.ts";
import { MCP_DEFAULT_TIMEOUT_MS, assertMcpServerConfig } from "./client.ts";
import { McpError } from "./errors.ts";
import type { BridgeRequest, BridgeResponse, McpToolInfo } from "./types.ts";

/**
 * Synchronous facade over the async MCP client. `AtsAdapter.pull/apply` and
 * `SourcingAdapter.search` are synchronous seams, so the async SDK runs in a
 * worker thread and the calling thread blocks on `Atomics.wait` (with a hard
 * timeout — misconfigured or unreachable servers fail closed, never hang).
 */
export type SyncMcpClient = {
  listTools(): McpToolInfo[];
  callTool(name: string, args?: Record<string, unknown>): unknown;
  close(): void;
  /** Pid of the spawned stdio server, once connected (null before / for HTTP). */
  serverPid(): number | null;
};

// The SDK's stdio close waits up to 2s after ending stdin, then up to 2s more
// after SIGTERM, before escalating to SIGKILL. The bridge close budget must
// exceed that worst case or a normal close lands in the terminate fallback.
const SDK_CLOSE_GRACE_MS = 4_000;

let liveClients = 0;

/** Live bridge workers (opened and not yet closed). Lets tests assert cleanup. */
export function openSyncMcpClientCount(): number {
  return liveClients;
}

export function openSyncMcpClient(config: McpServerConfig): SyncMcpClient {
  assertMcpServerConfig(config);
  const timeoutMs = config.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
  const { port1, port2 } = new MessageChannel();
  // The worker writes the spawned server's pid here right after connecting, so
  // terminate fallbacks can kill the child directly: worker.terminate() only
  // tears down the thread and would orphan the server process.
  const pidBuffer = new SharedArrayBuffer(4);
  const pidFlag = new Int32Array(pidBuffer);
  const worker = new Worker(fileURLToPath(new URL("./worker.ts", import.meta.url)), {
    workerData: { port: port2, config, pidBuffer },
    transferList: [port2],
  });
  worker.unref();
  liveClients += 1;
  let closed = false;

  function markClosed(): void {
    if (!closed) {
      closed = true;
      liveClients -= 1;
    }
  }

  function killSpawnedServer(): void {
    const pid = Atomics.exchange(pidFlag, 0, 0);
    if (pid <= 0) {
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return; // Already gone.
    }
    const escalate = setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Exited after SIGTERM.
      }
    }, 2_000);
    escalate.unref();
  }

  function request(message: Omit<BridgeRequest, "signal">, waitMs: number): unknown {
    if (closed) {
      throw new McpError("mcp_unavailable", "mcp client is closed");
    }
    const signal = new SharedArrayBuffer(4);
    const flag = new Int32Array(signal);
    port1.postMessage({ ...message, signal } satisfies BridgeRequest);
    const status = Atomics.wait(flag, 0, 0, waitMs);
    if (status === "timed-out") {
      markClosed();
      void worker.terminate();
      killSpawnedServer();
      throw new McpError("mcp_timeout", `${message.op} did not complete within ${waitMs}ms`);
    }
    const received = receiveMessageOnPort(port1) as { message: BridgeResponse } | undefined;
    if (!received) {
      markClosed();
      void worker.terminate();
      killSpawnedServer();
      throw new McpError("mcp_unavailable", "mcp worker sent no response");
    }
    const response = received.message;
    if (!response.ok) {
      throw new McpError(response.error.code, response.error.detail);
    }
    return response.value;
  }

  // First call may connect (spawn/initialize) and then issue the request, so
  // allow both to run to their own timeout before the bridge gives up.
  const waitMs = timeoutMs * 2 + 2_000;

  return {
    listTools() {
      return request({ op: "listTools" }, waitMs) as McpToolInfo[];
    },
    callTool(name, args = {}) {
      return request({ op: "callTool", name, args }, waitMs);
    },
    close() {
      if (closed) {
        return;
      }
      let closedCleanly = false;
      try {
        request({ op: "close" }, Math.max(timeoutMs, SDK_CLOSE_GRACE_MS) + 2_000);
        closedCleanly = true;
      } catch {
        // Fail-closed: termination and the child kill below are the backstop.
      }
      markClosed();
      void worker.terminate();
      if (!closedCleanly) {
        killSpawnedServer();
      }
    },
    serverPid() {
      const pid = Atomics.load(pidFlag, 0);
      return pid > 0 ? pid : null;
    },
  };
}
