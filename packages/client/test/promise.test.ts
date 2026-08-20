import { expect, test } from "bun:test"
import { isUnauthorizedError, Moks } from "../src"

test("exposes every standard HTTP API group", () => {
  const client = Moks.make({ baseUrl: "http://localhost:3000" })

  expect(Object.keys(client)).toEqual([
    "health",
    "location",
    "agents",
    "models",
    "providers",
    "integrations",
    "credentials",
    "permissions",
    "files",
    "commands",
    "skills",
    "events",
    "ptys",
    "questions",
    "references",
    "projectCopies",
  ])
  expect(Object.keys(client.integrations)).toEqual([
    "list",
    "get",
    "connectKey",
    "connectOauth",
    "attemptStatus",
    "attemptComplete",
    "attemptCancel",
  ])
  expect(Object.keys(client.files)).toEqual(["list", "find"])
  expect(Object.keys(client.ptys)).toEqual(["list", "create", "get", "update", "remove"])
})

test("events.subscribe exposes the Promise event stream wire projection", async () => {
  const client = Moks.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      new Response(
        `: heartbeat\n\ndata: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n` +
          `data: ${JSON.stringify(modelSwitchedEvent)}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  })
  const events = []
  for await (const event of client.events.subscribe()) events.push(event)

  expect(events).toEqual([{ id: "evt_connected", type: "server.connected", data: {} }, modelSwitchedEvent])
  expect(events[1]?.type === "session.next.model.switched" && events[1].data.timestamp).toBe(1_717_171_717_000)
})

test("events.subscribe terminates on malformed Promise SSE data", async () => {
  const client = Moks.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } }),
  })

  await expect(client.events.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: "ClientError",
    reason: "MalformedResponse",
  })
})

test("middleware errors remain declared client errors", async () => {
  const client = Moks.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 }),
  })

  try {
    await client.health.get()
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isUnauthorizedError(error)).toBe(true)
  }
})

const modelSwitchedEvent = {
  id: "evt_model",
  type: "session.next.model.switched",
  durable: { aggregateID: "ses_test", seq: 1, version: 1 },
  data: {
    timestamp: 1_717_171_717_000,
    sessionID: "ses_test",
    messageID: "msg_model",
    model: { id: "claude", providerID: "anthropic" },
  },
}
