import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Flag } from "@moks/core/flag/flag"
import { Effect, Schema } from "effect"

test("embedded client uses the real router and handlers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moks-embedded-"))
  const database = Flag.MOKS_DB
  Flag.MOKS_DB = join(directory, "moks.sqlite")
  const { Moks, Tool } = await import("../src")

  try {
    const program = Effect.gen(function* () {
      const moks = yield* Moks.create()
      yield* moks.tools.register({
        embedded_tool: Tool.make({
          description: "Embedded test tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.succeed({ ok: true }),
        }),
      })
      const health = yield* moks.health.get()
      expect(health.healthy).toBe(true)
    })
    await Effect.runPromise(Effect.scoped(program))
  } finally {
    Flag.MOKS_DB = database
    await rm(directory, { recursive: true, force: true })
  }
})
