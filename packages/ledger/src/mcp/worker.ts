import { workerData } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import type { McpServerConfig } from "../config.ts";
import { connectMcp, type McpConnection } from "./client.ts";
import { McpError } from "./errors.ts";
import type { BridgeRequest, BridgeResponse } from "./types.ts";

const { port, config, pidBuffer } = workerData as {
  port: MessagePort;
  config: McpServerConfig;
  pidBuffer?: SharedArrayBuffer;
};

// The spawned server's pid, shared with the parent thread so a terminate
// fallback can still kill the child (worker.terminate() alone orphans it).
const pidFlag = pidBuffer ? new Int32Array(pidBuffer) : null;

let connection: McpConnection | null = null;
let queue: Promise<void> = Promise.resolve();

async function run(request: BridgeRequest): Promise<unknown> {
  if (request.op === "close") {
    const open = connection;
    connection = null;
    await open?.close();
    if (pidFlag) {
      // The SDK close killed the child; the parent must not signal a reused pid.
      Atomics.store(pidFlag, 0, 0);
    }
    return null;
  }
  connection ??= await connectMcp(config);
  if (pidFlag && connection.pid !== null) {
    Atomics.store(pidFlag, 0, connection.pid);
  }
  if (request.op === "listTools") {
    return connection.listTools();
  }
  return connection.callTool(request.name ?? "", request.args ?? {});
}

function toWireError(error: unknown): BridgeResponse {
  if (error instanceof McpError) {
    const prefix = `${error.code}: `;
    const detail = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
    return { ok: false, error: { code: error.code, detail } };
  }
  return {
    ok: false,
    error: { code: "mcp_unavailable", detail: error instanceof Error ? error.message : String(error) },
  };
}

async function handle(request: BridgeRequest): Promise<void> {
  const flag = new Int32Array(request.signal);
  try {
    const value = await run(request);
    port.postMessage({ ok: true, value } satisfies BridgeResponse);
  } catch (error) {
    port.postMessage(toWireError(error));
  } finally {
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  }
}

port.on("message", (request: BridgeRequest) => {
  queue = queue.then(() => handle(request));
});
