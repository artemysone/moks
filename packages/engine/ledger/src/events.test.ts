import { describe, expect, test } from "bun:test";
import { createEventBus, createPermissionGate, encodeSse } from "./events.ts";

describe("EventBus", () => {
  test("publishes to every subscriber", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const first = bus.subscribe((event) => seen.push(`a:${event.type}`));
    bus.subscribe((event) => seen.push(`b:${event.type}`));
    bus.publish({ type: "server.connected" });
    expect(seen).toEqual(["a:server.connected", "b:server.connected"]);
    first();
    bus.publish({ type: "sync.updated", properties: { ats: "mock" } });
    expect(seen).toEqual(["a:server.connected", "b:server.connected", "b:sync.updated"]);
    expect(bus.size()).toBe(1);
  });

  test("encodeSse matches the TUI contract", () => {
    expect(encodeSse({ type: "server.connected" })).toBe(
      `event: server.connected\ndata: {"type":"server.connected"}\n\n`,
    );
  });

  test("session.aborted publishes and encodes like other session events", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.type));
    bus.publish({ type: "session.aborted", properties: { session_id: "sess_1" } });
    expect(seen).toEqual(["session.aborted"]);
    expect(encodeSse({ type: "session.aborted", properties: { session_id: "sess_1" } })).toBe(
      `event: session.aborted\ndata: {"type":"session.aborted","properties":{"session_id":"sess_1"}}\n\n`,
    );
  });

  test("session.compacted publishes and encodes like other session events", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.type));
    const compacted = {
      type: "session.compacted",
      properties: { session_id: "sess_1", summary_message_id: "msg_9", compacted_messages: 6, kept_messages: 2 },
    } as const;
    bus.publish(compacted);
    expect(seen).toEqual(["session.compacted"]);
    expect(encodeSse(compacted)).toBe(`event: session.compacted\ndata: ${JSON.stringify(compacted)}\n\n`);
  });

  test("session.compaction_failed publishes and encodes like other session events", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.type));
    const failed = {
      type: "session.compaction_failed",
      properties: { session_id: "sess_1", reason: "summarizer_down: upstream 500" },
    } as const;
    bus.publish(failed);
    expect(seen).toEqual(["session.compaction_failed"]);
    expect(encodeSse(failed)).toBe(`event: session.compaction_failed\ndata: ${JSON.stringify(failed)}\n\n`);
  });

  test("plugin.warning publishes and encodes like other events", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.type));
    const warning = {
      type: "plugin.warning",
      properties: { plugin: ".mox/plugins/a.ts", hook: "tool.execute.after", message: "boom" },
    } as const;
    bus.publish(warning);
    expect(seen).toEqual(["plugin.warning"]);
    expect(encodeSse(warning)).toBe(`event: plugin.warning\ndata: ${JSON.stringify(warning)}\n\n`);
  });

  test("permission gate times out as deny", async () => {
    const bus = createEventBus();
    const gate = createPermissionGate(bus);
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.type));
    const response = await gate.ask(
      {
        session_id: "sess",
        mutations: ["SendOutreach"],
        effect_classes: ["irreversible"],
        gate: "always",
        summary: "ledger_commit: SendOutreach",
      },
      20,
    );
    expect(response).toBe("deny");
    expect(events).toEqual(["permission.asked", "permission.resolved"]);
    expect(gate.resolve("missing", "allow")).toBe(false);
  });

  test("permission resolve requires the matching session id", async () => {
    const bus = createEventBus();
    const gate = createPermissionGate(bus);
    const pending = gate.ask(
      {
        session_id: "sess_a",
        mutations: ["SendOutreach"],
        effect_classes: ["irreversible"],
        gate: "always",
        summary: "ledger_commit: SendOutreach",
      },
      2_000,
    );
    await Bun.sleep(5);
    expect(gate.pending()).toHaveLength(1);
    expect(gate.resolve(gate.pending()[0]!.properties.permission_id, "allow", "sess_b")).toBe(false);
    expect(gate.pending()).toHaveLength(1);
    expect(gate.resolve(gate.pending()[0]!.properties.permission_id, "allow", "sess_a")).toBe(true);
    expect(await pending).toBe("allow");
  });
});
