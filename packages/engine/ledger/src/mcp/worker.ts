import { workerData } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import type { McpServerConfig } from "../config.ts";
import { parseJsonText, type Json } from "../json.ts";
import { connectMcp, type McpConnection } from "./client.ts";
import { McpError } from "./errors.ts";
import type { BridgeRequest, BridgeResponse } from "./types.ts";

type WorkerInit = {
  port: MessagePort;
  config: McpServerConfig;
  pidBuffer?: SharedArrayBuffer;
};

// SAFETY: this worker is spawned with { port, config, pidBuffer }.
const init: WorkerInit = workerData;
const port = init.port;
const config = init.config;
const pidBuffer = init.pidBuffer;

// The spawned server's pid, shared with the parent thread so a terminate
// fallback can still kill the child (worker.terminate() alone orphans it).
const pidFlag = pidBuffer ? new Int32Array(pidBuffer) : null;

let connection: McpConnection | null = null;
let queue: Promise<void> = Promise.resolve();

async function run(request: BridgeRequest): Promise<Json> {
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
    return parseJsonText(JSON.stringify(await connection.listTools()));
  }
  return connection.callTool(request.name ?? "", request.args ?? {});
}

function toWireError(cause: unknown): BridgeResponse {
  if (cause instanceof McpError) {
    const prefix = `${cause.code}: `;
    const detailText = cause.message.startsWith(prefix) ? cause.message.slice(prefix.length) : cause.message;
    return { ok: false, error: { code: cause.code, detail: detailText } };
  }
  return {
    ok: false,
    error: { code: "mcp_unavailable", detail: cause instanceof Error ? cause.message : String(cause) },
  };
}

async function handle(request: BridgeRequest): Promise<void> {
  const flag = new Int32Array(request.signal);
  try {
    const value = await run(request);
    port.postMessage({ ok: true, value } satisfies BridgeResponse);
  } catch (cause) {
    port.postMessage(toWireError(cause));
  } finally {
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  }
}

port.on("message", (request: BridgeRequest) => {
  queue = queue.then(() => handle(request));
});
