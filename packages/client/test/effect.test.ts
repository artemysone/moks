import { expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Moks } from "../src/effect"

test("events.subscribe exposes and decodes the native Effect event stream", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n` +
            `data: ${JSON.stringify(modelSwitchedEvent)}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    ),
  )
  const events = await Effect.gen(function* () {
    const client = yield* Moks.make({ baseUrl: "http://localhost:3000" })
    return yield* client.events.subscribe().pipe(Stream.runCollect)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(Array.from(events).map((event) => event.type)).toEqual(["server.connected", "session.next.model.switched"])
  const durable = events[1]
  if (durable?.type !== "session.next.model.switched") throw new Error("Expected model event")
  expect(DateTime.toEpochMillis(durable.data.timestamp)).toBe(1_717_171_717_000)
  expect(durable.durable).toEqual({ aggregateID: "ses_test", seq: 1, version: 1 })
})

test("events.subscribe terminates on Effect protocol decode failures", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(`data: {"type":"server.connected"}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    ),
  )
  const error = await Effect.gen(function* () {
    const client = yield* Moks.make({ baseUrl: "http://localhost:3000" })
    return yield* client.events.subscribe().pipe(Stream.runCollect, Effect.flip)
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)

  expect(error._tag).toBe("ClientError")
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
